// A3: frame-by-frame export. Start `npm run dev` first.
//  1. Browser: a 60 s 1080p60 project with 3D and motion blur exports in under
//     30 s, has exactly 3600 evenly spaced frames and an audio track, and a
//     frame matches the shared compositor.
//  2. Browser: cuts + a 2x speed section give the exact edited frame count and
//     keep the 440 Hz test tone at 440 Hz (pitch preserved).
//  3. Browser: cancelling rejects with AbortError and produces no file.
//  4. Desktop: exporting with the window minimized still finishes, the file is
//     streamed to disk, and a cancelled export leaves no file behind.
import { chromium, _electron as electron, expect } from "@playwright/test";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const bin = "C:/Program Files (x86)/Common Files/AutoPod/ffmpeg/bin";
const ffmpeg = process.env.FFMPEG_PATH || `${bin}/ffmpeg.exe`;
const ffprobe = process.env.FFPROBE_PATH || `${bin}/ffprobe.exe`;
const run = promisify(execFile);
const source = "tests/a3-source.mp4";
if (!existsSync(source)) {
  console.log("Building the 60 s 1080p60 fixture…");
  await run(ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1920x1080:rate=60:duration=60",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=60",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "28",
    "-g",
    "120",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    source,
  ]);
}

async function probe(file) {
  const { stdout } = await run(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,codec_name,width,height,nb_frames,duration",
    "-of",
    "json",
    file,
  ]);
  const streams = JSON.parse(stdout).streams;
  const { stdout: packets } = await run(
    ffprobe,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "packet=pts_time",
      "-of",
      "csv=p=0",
      file,
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const pts = packets
    .trim()
    .split(/\r?\n/)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const gaps = pts.slice(1).map((t, i) => t - pts[i]);
  return {
    video: streams.find((s) => s.codec_type === "video"),
    audio: streams.find((s) => s.codec_type === "audio"),
    frames: pts.length,
    minGap: Math.min(...gaps),
    maxGap: Math.max(...gaps),
  };
}

function decode(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ["-v", "error", ...args, "-"]);
    const chunks = [];
    p.stdout.on("data", (c) => chunks.push(c));
    p.on("error", reject);
    p.on("close", () => resolve(Buffer.concat(chunks)));
  });
}
function pitch(samples, rate) {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++)
    if (samples[i - 1] < 0 && samples[i] >= 0) crossings++;
  return crossings / (samples.length / rate);
}

const results = {};
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByText("Saved locally", { exact: true }).waitFor();
  const setup = `
    const { newProject } = await import("/src/types.ts");
    const { exportProject } = await import("/src/exporter.ts");
    const video = await (await fetch("/tests/a3-source.mp4")).blob();
    const make = (duration) => {
      const p = newProject(false);
      p.video = video;
      p.duration = 60;
      p.trimEnd = duration;
      p.settings.autoZoom = false;
      p.settings.followCursor = false;
      return p;
    };
    const save = (blob, name) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
    };`;

  // 1. Speed, frame count, audio, frame match.
  const downloaded = page.waitForEvent("download", { timeout: 180000 });
  const main = await page.evaluate(
    new Function(
      `return (async () => {${setup}
      const p = make(60);
      p.settings.motionMode = "3d";
      p.settings.motionBlur = 25;
      p.zooms = [{ id: "z", start: 10, end: 20, x: 0.3, y: 0.4, scale: 1.8, mode: "3d", follow: false, tiltX: -12, tiltY: 20, tiltZ: -3 }];
      const started = performance.now();
      const blob = await exportProject(p, { format: "mp4", height: 1080, fps: 60, signal: new AbortController().signal, progress: () => {} });
      const seconds = (performance.now() - started) / 1000;
      save(blob, "a3-export.mp4");
      // Expected frame at output 15.5 s, rendered from the exact source frame.
      const { Input, BlobSource, ALL_FORMATS, VideoSampleSink } = await import("/node_modules/.vite/deps/mediabunny.js");
      const { renderFrame } = await import("/src/compositor.ts");
      const input = new Input({ source: new BlobSource(video), formats: ALL_FORMATS });
      const sample = await new VideoSampleSink(await input.getPrimaryVideoTrack()).getSample(15.5);
      const canvas = document.createElement("canvas");
      canvas.width = 1920; canvas.height = 1080;
      renderFrame(canvas, p, 15.5, { frame: { image: sample.toCanvasImageSource(), width: sample.displayWidth, height: sample.displayHeight } });
      sample.close();
      const small = document.createElement("canvas");
      small.width = 640; small.height = 360;
      const ctx = small.getContext("2d");
      ctx.drawImage(canvas, 0, 0, 640, 360);
      const rgba = ctx.getImageData(0, 0, 640, 360).data;
      let binary = "";
      for (let i = 0; i < rgba.length; i += 4) binary += String.fromCharCode(rgba[i], rgba[i + 1], rgba[i + 2]);
      return { seconds, bytes: blob.size, expected: btoa(binary) };
    })()`,
    ),
  );
  const exported = path.join(root, "tests/a3-export.mp4");
  await (await downloaded).saveAs(exported);
  const info = await probe(exported);
  const frame = await decode([
    "-i",
    exported,
    "-vf",
    "select=eq(n\\,930),scale=640:360",
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
  ]);
  const expected = Buffer.from(main.expected, "base64");
  let difference = 0;
  for (let i = 0; i < expected.length; i++)
    difference += Math.abs(expected[i] - frame[i]);
  difference /= expected.length;
  results.export60 = {
    seconds: +main.seconds.toFixed(2),
    speed: +(60 / main.seconds).toFixed(2),
    megabytes: +(main.bytes / 1e6).toFixed(1),
    ...info,
    frameDifference: +difference.toFixed(2),
  };

  // 2. Cuts and speed: exact frames, pitch preserved.
  const edited = page.waitForEvent("download", { timeout: 120000 });
  await page.evaluate(
    new Function(
      `return (async () => {${setup}
      const p = make(12);
      p.cuts = [{ id: "c", start: 2, end: 4 }];
      p.speeds = [{ id: "s", start: 6, end: 10, rate: 2 }];
      const blob = await exportProject(p, { format: "mp4", height: 720, fps: 60, signal: new AbortController().signal, progress: () => {} });
      save(blob, "a3-edited.mp4");
    })()`,
    ),
  );
  const editedFile = path.join(root, "tests/a3-edited.mp4");
  await (await edited).saveAs(editedFile);
  const editedInfo = await probe(editedFile);
  const pcm = await decode([
    "-i",
    editedFile,
    "-ac",
    "1",
    "-ar",
    "48000",
    "-f",
    "f32le",
  ]);
  const samples = new Float32Array(
    pcm.buffer,
    pcm.byteOffset,
    Math.floor(pcm.length / 4),
  );
  // Output 4-6 s is source 6-10 s at 2x; 0-2 s is untouched source.
  results.edited = {
    ...editedInfo,
    normalPitch: +pitch(samples.subarray(0.5 * 48000, 1.5 * 48000), 48000).toFixed(1),
    fastPitch: +pitch(samples.subarray(4.3 * 48000, 5.7 * 48000), 48000).toFixed(1),
    audioSeconds: +(samples.length / 48000).toFixed(3),
  };

  // 3. Cancel.
  let downloads = 0;
  page.on("download", () => downloads++);
  results.cancel = await page.evaluate(
    new Function(
      `return (async () => {${setup}
      const p = make(60);
      const controller = new AbortController();
      try {
        await exportProject(p, { format: "mp4", height: 1080, fps: 60, signal: controller.signal, progress: (share) => { if (share > 0.2) controller.abort(); } });
        return { error: null };
      } catch (e) {
        return { error: e.name };
      }
    })()`,
    ),
  );
  await page.waitForTimeout(1000);
  results.cancel.downloads = downloads;
  results.browserErrors = errors;
} finally {
  await browser.close();
}

// 4. Desktop: minimized export streams to disk; cancel removes the file.
const exportDir = path.join(root, "tests/.exports");
await fs.rm(exportDir, { recursive: true, force: true });
const app = await electron.launch({
  args: [".", "--dev"],
  cwd: root,
  env: {
    ...process.env,
    STUDIO_USER_DATA: path.join(root, "tests/.profile"),
    STUDIO_EXPORT_DIR: exportDir,
  },
});
try {
  const page = await app.firstWindow();
  await page.getByText("Saved locally", { exact: true }).waitFor();
  await page.evaluate(async () => {
    const { newProject } = await import("/src/types.ts");
    const { saveProject } = await import("/src/storage.ts");
    const p = newProject(false);
    p.name = "A3 desktop export";
    p.video = await (await fetch("/tests/a3-source.mp4")).blob();
    p.duration = 60;
    p.trimEnd = 60;
    p.updated = Date.now() + 60000;
    await saveProject(p);
  });
  await page.reload();
  await page.getByText("A3 desktop export", { exact: true }).waitFor();
  await page.getByText("Saved locally", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Export video", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Export format")).toHaveValue("mp4");
  await dialog.getByLabel("Export resolution").selectOption("1080");
  await dialog.getByLabel("Export frame rate").selectOption("60");
  const started = Date.now();
  await dialog.getByRole("button", { name: "Export video", exact: true }).click();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].minimize(),
  );
  const minimized = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].isMinimized(),
  );
  await dialog
    .getByText("That’s a wrap.", { exact: true })
    .waitFor({ timeout: 180000 });
  const seconds = (Date.now() - started) / 1000;
  const files = await fs.readdir(exportDir);
  const desktopInfo = await probe(path.join(exportDir, files[0]));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].restore(),
  );
  // Cancel partway through a second export.
  await dialog.getByRole("button", { name: "Export again", exact: true }).click();
  await expect
    .poll(
      async () =>
        +((await dialog
          .getByRole("progressbar", { name: "Export progress" })
          .getAttribute("aria-valuenow")
          .catch(() => "0")) || 0),
      { timeout: 60000 },
    )
    .toBeGreaterThan(10);
  const during = (await fs.readdir(exportDir)).length;
  await dialog.getByRole("button", { name: "Cancel export", exact: true }).click();
  await page
    .getByText("Export cancelled. Your project is unchanged.", { exact: true })
    .waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  results.desktop = {
    minimized,
    seconds: +seconds.toFixed(1),
    file: files[0],
    ...desktopInfo,
    filesDuringCancel: during,
    filesAfterCancel: (await fs.readdir(exportDir)).length,
  };
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close().catch(() => {});
}

await fs.writeFile(
  path.join(root, "tests/a3-results.json"),
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
const e = results.export60,
  d = results.edited,
  c = results.cancel,
  k = results.desktop;
expect(results.browserErrors).toEqual([]);
expect(e.seconds).toBeLessThan(30);
expect(e.frames).toBe(3600);
expect(e.maxGap - e.minGap).toBeLessThan(0.002);
expect(e.video.codec_name).toBe("h264");
expect(e.audio?.codec_name).toBe("aac");
expect(e.frameDifference).toBeLessThan(4);
expect(d.frames).toBe(480);
expect(Math.abs(d.audioSeconds - 8)).toBeLessThan(0.05);
expect(Math.abs(d.normalPitch - 440)).toBeLessThan(5);
expect(Math.abs(d.fastPitch - 440)).toBeLessThan(8);
expect(c.error).toBe("AbortError");
expect(c.downloads).toBe(0);
expect(k.minimized).toBe(true);
expect(k.frames).toBe(3600);
expect(k.filesDuringCancel).toBe(2);
expect(k.filesAfterCancel).toBe(1);
console.log(
  "PASS: 60 s 1080p60 export under 30 s with exact frames and audio, pitch-preserving speed-up, cancel cleanup, minimized desktop export to disk.",
);
