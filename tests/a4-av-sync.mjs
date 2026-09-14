// A4 audio/video sync, measured directly against the capture helper.
// A browser window plays a clip that flashes white with a 1 kHz tone on the
// same frames, five times. The helper records the display; we pair every
// flash with its tone in the recording and report the offsets
// (positive = sound later than picture). Waits for an idle PC because it
// shows a window and plays sound. `--offset-ms N` passes an audio offset to
// the helper to try a calibration.
import { chromium } from "@playwright/test";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);
const root = process.cwd();
const ffmpeg =
  process.env.FFMPEG_PATH ||
  "C:/Program Files (x86)/Common Files/AutoPod/ffmpeg/bin/ffmpeg.exe";
const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
if (!process.argv.includes("--force")) {
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "tests/idle.ps1"]);
  if (+stdout.trim() < 60) {
    console.log(`SKIPPED: the PC was used ${(+stdout.trim()).toFixed(0)} s ago.`);
    process.exit(3);
  }
}
const dir = path.join(root, "tests/.native");
await fs.mkdir(dir, { recursive: true });
const clip = path.join(dir, "av-loop.mp4");
await run(ffmpeg, [
  "-y", "-v", "error",
  "-f", "lavfi", "-i", "color=c=black:s=640x360:r=60:d=2",
  "-f", "lavfi", "-i", "aevalsrc='if(between(t,1,1.2),0.5*sin(2*PI*1000*t),0)':s=48000:d=2",
  "-vf", "drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='between(t,1,1.2)'",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "30", "-c:a", "aac", "-b:a", "192k", clip,
]);
const data = (await fs.readFile(clip)).toString("base64");

const browser = await chromium.launch({
  channel: "msedge",
  headless: false,
  args: ["--window-position=0,0", "--window-size=700,500", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.setContent(
  `<body style="margin:0;background:#000"><video id="v" style="width:640px;height:360px" preload="auto" src="data:video/mp4;base64,${data}"></video></body>`,
);
const output = path.join(dir, "av-sync.mp4"),
  events = path.join(dir, "av-sync.jsonl");
const config = { output, events, monitor: { x: 50, y: 50 }, fps: 60, audio: true };
if (flag("--offset-ms")) config.audioOffsetMs = Number(flag("--offset-ms"));
const helper = spawn("native/studio-capture/target/release/studio-capture.exe", ["record", JSON.stringify(config)], {
  stdio: ["pipe", "pipe", "inherit"],
});
await new Promise((resolve) => {
  helper.stdout.on("data", (d) => {
    if (String(d).includes('"started"')) resolve();
  });
});
await page.waitForTimeout(800);
for (let i = 0; i < 5; i++) {
  await page.evaluate(() => {
    const v = document.getElementById("v");
    v.currentTime = 0;
    return v.play();
  });
  await page.waitForTimeout(2300);
}
helper.stdin.write("stop\n");
await new Promise((r) => helper.on("exit", r));
await browser.close();

// Brightness of the top-left area (where the clip plays) per recorded frame.
const probe = await run(ffmpeg, ["-i", output]).catch((e) => e);
const [, w, h] = /, (\d{3,5})x(\d{3,5})/.exec(probe.stderr);
const width = +w,
  height = +h;
const frames = await new Promise((resolve) => {
  const p = spawn(ffmpeg, ["-v", "error", "-i", output, "-vf", "crop=800:400:100:250,scale=32:18", "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
  const chunks = [];
  p.stdout.on("data", (c) => chunks.push(c));
  p.on("close", () => resolve(Buffer.concat(chunks)));
});
const brightness = [];
for (let f = 0; f * 576 < frames.length; f++) {
  let sum = 0;
  for (let i = 0; i < 576; i++) sum += frames[f * 576 + i];
  brightness.push(sum / 576);
}
const pcm = await new Promise((resolve) => {
  const p = spawn(ffmpeg, ["-v", "error", "-i", output, "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"]);
  const chunks = [];
  p.stdout.on("data", (c) => chunks.push(c));
  p.on("close", () => resolve(Buffer.concat(chunks)));
});
const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4));
const flashes = [];
for (let f = 1; f < brightness.length; f++)
  if (brightness[f] > 128 && brightness[f - 1] <= 128) flashes.push(f / 60);
const tones = [];
let loud = false;
for (let i = 0; i + 240 < samples.length; i += 48) {
  let e = 0;
  for (let j = 0; j < 240; j++) e += samples[i + j] * samples[i + j];
  const on = Math.sqrt(e / 240) > 0.05;
  if (on && !loud) tones.push(i / 48000);
  loud = on;
}
const offsets = flashes
  .map((t) => {
    const tone = tones.find((s) => Math.abs(s - t) < 0.3);
    return tone === undefined ? null : Math.round((tone - t) * 1000);
  })
  .filter((v) => v !== null);
const mean = offsets.reduce((a, b) => a + b, 0) / (offsets.length || 1);
const result = { frameSize: [width, height], flashes: flashes.length, tones: tones.length, offsetsMs: offsets, meanMs: Math.round(mean), audioOffsetMs: config.audioOffsetMs ?? 0 };
await fs.writeFile(path.join(root, "tests/a4-av-sync-results.json"), JSON.stringify(result, null, 2));
await fs.rm(output, { force: true });
await fs.rm(events, { force: true });
console.log(result);
if (offsets.length < 3) {
  console.log("FAIL: could not pair enough flashes with tones.");
  process.exit(1);
}
if (Math.abs(mean) > 20) {
  console.log(`FAIL: sound is ${Math.round(mean)} ms ${mean > 0 ? "behind" : "ahead of"} the picture.`);
  process.exit(1);
}
console.log(`PASS: audio and video within ${Math.round(Math.abs(mean))} ms on average.`);
