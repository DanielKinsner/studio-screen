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
import { audioFilter, flashFilter, flashTimes, pairOffsets } from "./av-measure.mjs";

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
  args: ["--window-position=0,0", "--start-fullscreen", "--autoplay-policy=no-user-gesture-required"],
});
let helper;
const output = path.join(dir, "av-sync.mp4"),
  events = path.join(dir, "av-sync.jsonl");
try {
const page = await browser.newPage({ viewport: null });
const cdp = await page.context().newCDPSession(page);
const { windowId } = await cdp.send("Browser.getWindowForTarget");
await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
await cdp.send("Browser.setWindowBounds", { windowId, bounds: { left: 0, top: 0, width: 700, height: 500 } });
await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "fullscreen" } });
console.log("Fixture window:", await cdp.send("Browser.getWindowBounds", { windowId }));
await page.setContent(
  `<body style="margin:0;background:#000;overflow:hidden"><video id="v" style="width:100vw;height:100vh;object-fit:fill" preload="auto" src="data:video/mp4;base64,${data}"></video></body>`,
);
const config = { output, events, monitor: { x: 50, y: 50 }, fps: 60, audio: true };
if (flag("--offset-ms")) config.audioOffsetMs = Number(flag("--offset-ms"));
helper = spawn("native/studio-capture/target/release/studio-capture.exe", ["record", JSON.stringify(config)], {
  stdio: ["pipe", "pipe", "inherit"],
});
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Helper did not start in 20 seconds")), 20000);
  helper.once("error", (error) => { clearTimeout(timeout); reject(error); });
  helper.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Helper exited before startup: ${code}`)); });
  helper.stdout.on("data", (d) => {
    if (String(d).includes('"started"')) { clearTimeout(timeout); resolve(); }
  });
});
await page.bringToFront();
await page.waitForTimeout(800);
// Six plays; the first warms up the decoder and audio device and is ignored.
for (let i = 0; i < 6; i++) {
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

// Fullscreen fixture: sample the central region independent of display DPI.
const probe = await run(ffmpeg, ["-i", output]).catch((e) => e);
const [, w, h] = /, (\d{3,5})x(\d{3,5})/.exec(probe.stderr);
const width = +w,
  height = +h;
const frames = await new Promise((resolve) => {
  const p = spawn(ffmpeg, ["-v", "error", "-i", output, "-vf", flashFilter, "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
  const chunks = [];
  p.stdout.on("data", (c) => chunks.push(c));
  p.on("close", () => resolve(Buffer.concat(chunks)));
});
const pcm = await new Promise((resolve) => {
  const p = spawn(ffmpeg, ["-v", "error", "-i", output, "-vn", "-af", audioFilter, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"]);
  const chunks = [];
  p.stdout.on("data", (c) => chunks.push(c));
  p.on("close", () => resolve(Buffer.concat(chunks)));
});
const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4));
const flashes = flashTimes(frames);
const frameMeans = [];
for (let i = 0; i + 576 <= frames.length; i += 576)
  frameMeans.push(frames.subarray(i, i + 576).reduce((a, b) => a + b, 0) / 576);
console.log("Sampled brightness:", { frames: frameMeans.length, min: Math.min(...frameMeans), max: Math.max(...frameMeans) });
const tones = [];
let loud = false;
for (let i = 0; i + 240 < samples.length; i += 48) {
  let e = 0;
  for (let j = 0; j < 240; j++) e += samples[i + j] * samples[i + j];
  const on = Math.sqrt(e / 240) > 0.05;
  if (on && !loud) tones.push(i / 48000);
  loud = on;
}
const { offsetsMs: offsets, meanMs: mean } = pairOffsets(flashes, tones);
console.log("Onsets:", { flashes, tones });
const result = { frameSize: [width, height], flashes: flashes.length, tones: tones.length, offsetsMs: offsets, meanMs: mean === null ? null : Math.round(mean), audioOffsetMs: config.audioOffsetMs ?? 0 };
await fs.writeFile(path.join(root, "tests/a4-av-sync-results.json"), JSON.stringify(result, null, 2));
await fs.rm(output, { force: true });
await fs.rm(events, { force: true });
console.log(result);
if (offsets.length < 3) {
  console.log("FAIL: could not pair enough flashes with tones.");
  process.exitCode = 1;
} else if (Math.abs(mean) > 20) {
  console.log(`FAIL: sound is ${Math.round(mean)} ms ${mean > 0 ? "behind" : "ahead of"} the picture.`);
  process.exitCode = 1;
} else console.log(`PASS: audio and video within ${Math.round(Math.abs(mean))} ms on average.`);
} finally {
  if (helper && helper.exitCode === null && helper.signalCode === null) {
    helper.kill();
    await new Promise((resolve) => helper.once("exit", resolve));
  }
  await browser.close();
  await fs.rm(output, { force: true });
  await fs.rm(events, { force: true });
}
