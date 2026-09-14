import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const encoder =
  process.env.FFMPEG_PATH ||
  "C:/Program Files (x86)/Common Files/AutoPod/ffmpeg/bin/ffmpeg.exe";
await promisify(execFile)(
  encoder,
  [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=seagreen:s=640x360:r=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "tests/fade-fixture.mp4",
  ],
  { windowsHide: true },
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5173");
  const input = (await fs.readFile("tests/fade-fixture.mp4")).toString(
    "base64",
  );
  const out = await page.evaluate(async (data) => {
    const { newProject } = await import("/src/types.ts");
    const { exportProject } = await import("/src/exporter.ts");
    const p = newProject(false);
    p.video = new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], {
      type: "video/mp4",
    });
    p.duration = 4;
    p.trimEnd = 4;
    p.settings.sourceFade = 0.8;
    p.settings.autoZoom = false;
    p.cuts = [{ id: "c", start: 1, end: 1.5 }];
    p.speeds = [{ id: "s", start: 2, end: 3, rate: 2 }];
    const blob = await exportProject(p, {
      format: "webm",
      height: 480,
      fps: 30,
      signal: new AbortController().signal,
      progress: () => {},
    });
    return await new Promise((r) => {
      const f = new FileReader();
      f.onload = () => r(f.result);
      f.readAsDataURL(blob);
    });
  }, input);
  await fs.writeFile(
    "tests/fade-export.webm",
    Buffer.from(out.split(";base64,")[1], "base64"),
  );
  const ffmpeg =
    process.env.FFMPEG_PATH ||
    "C:/Program Files (x86)/Common Files/AutoPod/ffmpeg/bin/ffmpeg.exe";
  const { stdout } = await promisify(execFile)(
    ffmpeg,
    [
      "-v",
      "error",
      "-i",
      "tests/fade-export.webm",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "8000",
      "-f",
      "f32le",
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: 8000000, windowsHide: true },
  );
  const samples = new Float32Array(
    stdout.buffer,
    stdout.byteOffset,
    stdout.byteLength / 4,
  );
  const rms = (a, b) => {
    let energy = 0,
      n = 0;
    for (
      let i = Math.round(a * 8000);
      i < Math.min(samples.length, b * 8000);
      i++
    ) {
      energy += samples[i] ** 2;
      n++;
    }
    return 10 * Math.log10(energy / n);
  };
  const result = {
    seconds: samples.length / 8000,
    startDb: rms(0.05, 0.2),
    middleDb: rms(1.3, 1.6),
    endDb: rms(2.8, 2.95),
  };
  expect(result.seconds).toBeGreaterThan(2.9);
  expect(result.seconds).toBeLessThan(3.2);
  expect(result.startDb).toBeLessThan(result.middleDb - 8);
  expect(result.endDb).toBeLessThan(result.middleDb - 8);
  await fs.writeFile(
    "tests/fade-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log("PASS edited audio fades", result);
} finally {
  await browser.close();
}
