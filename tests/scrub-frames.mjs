// Scrubbing never flashes the empty card (headless Edge, synthetic input; safe
// while the PC is in use). Start `npm run dev` first.
//  - Opens a 20 s 1080p60 H.264 fixture (built with FFmpeg, never committed)
//    with 5 s keyframe spacing so seeks are slow, like long native recordings.
//  - Scrubs with 40 pointer moves while sampling the preview centre on every
//    animation frame: it must never show the placeholder colour #eff0ea.
//  - After release, the paused preview matches the exact decoded frame at the
//    playhead (and not frames a quarter second either side).
import { chromium } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";

const run = promisify(execFile);
const ffmpeg =
  process.env.FFMPEG_PATH ||
  "C:/Program Files (x86)/Common Files/AutoPod/ffmpeg/bin/ffmpeg.exe";
const source = "tests/scrub-source.mp4";
if (!existsSync(source)) {
  console.log("Building the 20 s 1080p60 scrub fixture…");
  await run(ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1920x1080:rate=60:duration=20",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "30",
    "-g",
    "300",
    "-pix_fmt",
    "yuv420p",
    source,
  ]);
}

const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1480, height: 980 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByText("Saved locally", { exact: true }).waitFor();
  await page.evaluate(async () => {
    const { newProject } = await import("/src/types.ts");
    const { saveProject } = await import("/src/storage.ts");
    const p = newProject(false);
    p.id = "scrub-frames";
    p.name = "Scrub frames";
    p.video = await (await fetch("/tests/scrub-source.mp4")).blob();
    p.duration = 20;
    p.trimEnd = 20;
    p.settings.autoZoom = false;
    p.settings.showCursor = false;
    p.updated = Date.now() + 60000;
    await saveProject(p);
  });
  await page.reload();
  await page.getByText("Saved locally", { exact: true }).waitFor();
  // Wait for the first real frame, then sample the centre every frame.
  const started = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const canvas = document.querySelector(
          'canvas[aria-label="Composited video preview"]',
        );
        const placeholder = (d) =>
          Math.abs(d[0] - 0xef) <= 3 &&
          Math.abs(d[1] - 0xf0) <= 3 &&
          Math.abs(d[2] - 0xea) <= 3;
        const centre = () =>
          canvas
            .getContext("2d")
            .getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data;
        const deadline = performance.now() + 15000;
        const wait = () => {
          if (!placeholder(centre())) {
            window.__scrub = { frames: 0, white: 0, samples: [] };
            const sample = () => {
              const d = centre();
              window.__scrub.frames++;
              if (placeholder(d)) window.__scrub.white++;
              if (window.__scrub.samples.length < 5)
                window.__scrub.samples.push([...d.slice(0, 3)]);
              window.__scrubFrame = requestAnimationFrame(sample);
            };
            window.__scrubFrame = requestAnimationFrame(sample);
            resolve(true);
          } else if (performance.now() > deadline) resolve(false);
          else requestAnimationFrame(wait);
        };
        wait();
      }),
  );
  check(started, "The first video frame never appeared in the preview.");

  const tracks = await page.locator(".tracks").boundingBox();
  const y = tracks.y + 12;
  await page.mouse.move(tracks.x + tracks.width * 0.05, y);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) {
    await page.mouse.move(
      tracks.x + tracks.width * (0.05 + (0.87 * i) / 40),
      y,
    );
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
  await page.waitForTimeout(2500);
  const scrub = await page.evaluate(() => {
    cancelAnimationFrame(window.__scrubFrame);
    return window.__scrub;
  });

  // The paused frame matches the decoded frame at the playhead.
  const match = await page.evaluate(async () => {
    const { renderFrame } = await import("/src/compositor.ts");
    const { listProjects } = await import("/src/storage.ts");
    const { Input, BlobSource, ALL_FORMATS, VideoSampleSink } = await import(
      "/node_modules/.vite/deps/mediabunny.js"
    );
    const p = (await listProjects()).find((v) => v.id === "scrub-frames");
    const left = parseFloat(document.querySelector(".playhead").style.left);
    const t = (left / 100) * p.duration;
    const preview = document.querySelector(
      'canvas[aria-label="Composited video preview"]',
    );
    const shrink = (image) => {
      const small = document.createElement("canvas");
      small.width = 320;
      small.height = 180;
      const ctx = small.getContext("2d");
      ctx.drawImage(image, 0, 0, 320, 180);
      return ctx.getImageData(0, 0, 320, 180).data;
    };
    const actual = shrink(preview);
    const input = new Input({
      source: new BlobSource(p.video),
      formats: ALL_FORMATS,
    });
    const sink = new VideoSampleSink(await input.getPrimaryVideoTrack());
    const expected = async (time) => {
      const sample = await sink.getSample(time);
      const canvas = document.createElement("canvas");
      canvas.width = preview.width;
      canvas.height = preview.height;
      renderFrame(canvas, p, time, {
        frame: {
          image: sample.toCanvasImageSource(),
          width: sample.displayWidth,
          height: sample.displayHeight,
        },
      });
      sample.close();
      const data = shrink(canvas);
      let sum = 0;
      for (let i = 0; i < data.length; i++)
        if (i % 4 !== 3) sum += Math.abs(data[i] - actual[i]);
      return sum / ((data.length / 4) * 3);
    };
    const result = {
      t,
      atPlayhead: await expected(t),
      before: await expected(Math.max(0, t - 0.25)),
      after: await expected(Math.min(p.duration - 0.02, t + 0.25)),
    };
    input.dispose();
    return result;
  });
  const results = { scrub, match, errors };
  await fs.writeFile(
    "tests/scrub-results.json",
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results));
  check(scrub.frames > 20, `Only ${scrub.frames} animation frames sampled.`);
  check(
    scrub.white === 0,
    `The preview showed the empty card on ${scrub.white} of ${scrub.frames} frames while scrubbing.`,
  );
  check(
    match.atPlayhead < 6 &&
      match.atPlayhead < match.before &&
      match.atPlayhead < match.after,
    `The paused frame does not match the frame at ${match.t.toFixed(3)} s (difference ${match.atPlayhead.toFixed(2)}; ±0.25 s: ${match.before.toFixed(2)} / ${match.after.toFixed(2)}).`,
  );
  check(!errors.length, errors.join("\n"));
  console.log(
    "PASS: scrubbing never showed the empty card, and the paused frame matches the playhead.",
  );
} finally {
  await browser.close();
}
