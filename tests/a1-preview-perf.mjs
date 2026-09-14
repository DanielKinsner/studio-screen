// A1 budget: preview playback holds 60 fps on a 10-minute project with 3D on.
// Passes when the 95th-percentile frame interval is at most 18 ms and fewer
// than 2% of frames are dropped.
// Start `npm run dev` first. Uses FFMPEG_PATH (or the AutoPod install) once to
// build a synthetic 10-minute source video, cached as tests/perf-source.mp4.
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";

const ffmpeg =
  process.env.FFMPEG_PATH ||
  "C:/Program Files (x86)/Common Files/AutoPod/ffmpeg/bin/ffmpeg.exe";
const source = "tests/perf-source.mp4";
const minutes = 10;
if (!existsSync(source)) {
  console.log("Building a 10-minute synthetic source video…");
  const made = spawnSync(
    ffmpeg,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=1280x720:rate=30:duration=${minutes * 60}`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "35",
      "-g",
      "60",
      "-pix_fmt",
      "yuv420p",
      source,
    ],
    { stdio: "inherit" },
  );
  if (made.status !== 0) throw new Error("FFmpeg could not build the source.");
}

// Like the real editor window on a 4K display at 150% scaling.
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 2560, height: 1400 },
    deviceScaleFactor: 1.5,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByText("Saved locally", { exact: true }).waitFor();
  const setup = await page.evaluate(async (minutes) => {
    const { newProject } = await import("/src/types.ts");
    const { saveProject } = await import("/src/storage.ts");
    const video = await (await fetch("/tests/perf-source.mp4")).blob();
    const p = newProject(false);
    const duration = minutes * 60;
    p.name = "Perf: 10-minute 3D";
    p.video = video;
    p.duration = duration;
    p.trimEnd = duration;
    p.updated = Date.now() + 60000;
    Object.assign(p.settings, {
      motionMode: "3d",
      motionBlur: 25,
      followCursor: true,
      cursorIdle: true,
      clickVolume: 0,
    });
    for (let i = 0; i < duration * 60; i++) {
      const t = i / 60;
      p.points.push({
        t,
        x: 0.5 + 0.35 * Math.sin(t / 2.3) + 0.004 * Math.sin(t * 37),
        y: 0.5 + 0.3 * Math.cos(t / 3.1),
        click: i % 300 === 150,
        typing: i % 600 < 90 && i % 20 === 0,
        shortcut: i % 1800 === 900 ? "Ctrl + K" : undefined,
      });
    }
    await saveProject(p);
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      points: p.points.length,
      renderer: info
        ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
        : "unknown",
    };
  }, minutes);
  await page.reload();
  await page.getByText("Perf: 10-minute 3D", { exact: true }).waitFor();
  await page.getByText("Saved locally", { exact: true }).waitFor();
  // Start two minutes in, inside the busy part of the project.
  await page.getByLabel("Trim start in seconds").fill("120");
  await page.getByText("Saved locally", { exact: true }).waitFor();
  await page.waitForTimeout(1500);
  const canvas = await page
    .getByLabel("Composited video preview")
    .evaluate((c) => ({ width: c.width, height: c.height }));
  await page.getByRole("button", { name: "Play video", exact: true }).click();
  await page.waitForTimeout(1000);
  const intervals = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const times = [];
        const start = performance.now();
        const tick = (now) => {
          times.push(now);
          if (now - start < 8000) requestAnimationFrame(tick);
          else resolve(times.slice(1).map((t, i) => t - times[i]));
        };
        requestAnimationFrame(tick);
      }),
  );
  const shown = await page.locator(".time-display").innerText();
  await page
    .getByRole("button", { name: "Pause playback", exact: true })
    .click();
  const sorted = [...intervals].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  // A frame that took more than 1.5 display refreshes means one was dropped.
  const dropped = intervals.filter((v) => v > 25).length / intervals.length;
  const result = {
    ...setup,
    canvas,
    frames: intervals.length,
    p95: +p95.toFixed(2),
    droppedShare: +dropped.toFixed(4),
    fps: +(
      1000 /
      (intervals.reduce((a, b) => a + b, 0) / intervals.length)
    ).toFixed(1),
    timeShown: shown,
    errors,
  };
  await fs.writeFile(
    "tests/a1-perf-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(result);
  if (errors.length) throw new Error(errors.join("\n"));
  if (!shown.startsWith("00:0") || shown.startsWith("00:00"))
    throw new Error(`Playback did not advance (showed ${shown}).`);
  if (p95 > 18 || dropped >= 0.02)
    throw new Error("FAIL: preview playback misses the 60 fps budget.");
  console.log("PASS: 10-minute 3D project plays at 60 fps.");
} finally {
  await browser.close();
}
