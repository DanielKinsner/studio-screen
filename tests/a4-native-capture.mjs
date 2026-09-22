// A4: native capture helper, end to end through the desktop app.
// Start `npm run dev` and `npm run native:build` first. This test moves the
// mouse, clicks, types and records a window, so it refuses to run unless the
// PC has been idle for 60 s (pass --force to skip that check).
//
// 1. Footage has no cursor (a control take with cursor capture on does).
// 2. Five clicks 30 ms apart, a right-click, a scroll, a shortcut, typing, and
//    the text/hand cursor shapes are all recorded.
// 3. The recorded click lands within 2 px of the marker it hit, in video pixels.
// 4. Audio and video line up within 20 ms (fixture flashes and beeps together).
// 5. Killing the helper keeps the take; killing the app leaves a recording that
//    is recovered on the next launch.
import { _electron as electron, expect } from "@playwright/test";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { audioFilter } from "./av-measure.mjs";

const exec = promisify(execFile);
const run = (file, args, options = {}) => exec(file, args, { windowsHide: true, ...options });
const root = process.cwd();
const bin = "C:/Program Files (x86)/Common Files/AutoPod/ffmpeg/bin";
const ffmpeg = process.env.FFMPEG_PATH || `${bin}/ffmpeg.exe`;
const projects = path.join(root, "tests/.projects");
const profile = path.join(root, "tests/.profile-a4");

if (!process.argv.includes("--force")) {
  const { stdout } = await run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "tests/idle.ps1",
  ]);
  if (+stdout.trim() < 60) {
    console.log(
      `SKIPPED: the PC was used ${(+stdout.trim()).toFixed(0)} s ago. Run when idle, or pass --force.`,
    );
    process.exit(3);
  }
}
await fs.rm(projects, { recursive: true, force: true });
await fs.rm(profile, { recursive: true, force: true });

// A/V fixture: black video that turns white for 0.25 s at 1 s while a 1 kHz
// tone plays over exactly those frames. Chromium keeps a playing video in
// lip-sync, so the recording should show the flash and tone together.
const avFile = path.join(root, "tests/.native/av-fixture.mp4");
await fs.mkdir(path.dirname(avFile), { recursive: true });
await run(ffmpeg, [
  "-y", "-v", "error",
  "-f", "lavfi", "-i", "color=c=black:s=320x180:r=60:d=3",
  "-f", "lavfi", "-i", "aevalsrc='if(between(t,1,1.25),0.5*sin(2*PI*1000*t),0)':s=48000:d=3",
  "-vf", "drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='between(t,1,1.25)'",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "30", "-c:a", "aac", "-b:a", "192k",
  avFile,
]);
const avData = (await fs.readFile(avFile)).toString("base64");
const fixtureHtml = `<!doctype html><title>Studio Screen Native Test</title>
<style>
  html,body{margin:0;height:100%;background:#2f6db5;overflow:hidden;font:22px sans-serif}
  #dot{position:fixed;left:30%;top:40%;width:8px;height:8px;margin:-4px 0 0 -4px;background:#ff2020;border-radius:50%}
  #field{position:fixed;left:55%;top:20%;width:35%;height:60px;font-size:24px}
  #link{position:fixed;left:55%;top:60%;width:35%;height:60px;background:#ffe08a;cursor:pointer}
  #av{position:fixed;right:0;bottom:0;width:20%;height:20%;object-fit:fill;background:#000}
</style>
<div id="dot"></div><input id="field" value=""><div id="link">link</div>
<video id="av" preload="auto" src="data:video/mp4;base64,${avData}"></video>
<script>
  window.flash = async () => {
    const v = document.getElementById("av");
    v.currentTime = 0;
    await v.play();
  };
</script>`;

async function launch(env = {}) {
  const app = await electron.launch({
    args: [".", "--dev"],
    cwd: root,
    env: {
      ...process.env,
      STUDIO_USER_DATA: profile,
      STUDIO_PROJECTS_DIR: projects,
      ...env,
    },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByText("Saved locally", { exact: true }).waitFor();
  return { app, page, errors };
}
async function openFixture(app) {
  await app.evaluate(async ({ BrowserWindow, screen }, html) => {
    const main = BrowserWindow.getAllWindows()[0];
    const area = screen.getDisplayMatching(main.getBounds()).workArea;
    const fixture = new BrowserWindow({
      width: 900,
      height: 640,
      x: Math.round(area.x + (area.width - 900) / 2),
      y: Math.round(area.y + (area.height - 640) / 2),
      title: "Studio Screen Native Test",
      autoHideMenuBar: true,
      webPreferences: { backgroundThrottling: false },
    });
    fixture.on("page-title-updated", (e) => e.preventDefault());
    // Windows won't let a background app raise a new window over the one in
    // front, so keep the fixture above everything for the injected input.
    fixture.setAlwaysOnTop(true, "screen-saver");
    await fixture.loadURL("data:text/html," + encodeURIComponent(html));
    fixture.moveTop();
  }, fixtureHtml);
  const fixture = app.windows().find((p) => p.url().startsWith("data:"));
  await fixture.waitForLoadState();
  return fixture;
}
/** Physical screen point of an element's centre in the fixture window. */
async function physical(app, fixture, selector) {
  const box = await fixture.locator(selector).boundingBox();
  return app.evaluate(
    ({ BrowserWindow, screen }, box) => {
      const w = BrowserWindow.getAllWindows().find(
        (w) => w.getTitle() === "Studio Screen Native Test",
      );
      const c = w.getContentBounds();
      return screen.dipToScreenPoint({
        x: c.x + box.x + box.width / 2,
        y: c.y + box.y + box.height / 2,
      });
    },
    box,
  );
}
async function startTake(page, { countdown = false } = {}) {
  await page.getByRole("button", { name: "New recording", exact: true }).click();
  await page
    .getByRole("button", { name: "Studio Screen Native Test", exact: true })
    .click();
  const toggle = page.getByRole("switch", { name: "3-second countdown", exact: true });
  if ((await toggle.getAttribute("aria-checked")) !== String(countdown))
    await toggle.click();
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
}
async function waitForBar(app) {
  await expect
    .poll(() => app.windows().some((p) => p.url().includes("#bar")), { timeout: 20000 })
    .toBe(true);
  return app.windows().find((p) => p.url().includes("#bar"));
}
async function input(script) {
  // The entire injection thread must be per-monitor DPI aware. Changing only
  // cursor placement still misdirects clicks/typing on the 150% display.
  await run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class T{[DllImport("user32.dll")]public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);[DllImport("user32.dll")]public static extern bool SetPhysicalCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void keybd_event(byte k,byte s,uint f,UIntPtr e);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,int d,UIntPtr e);}'
      [T]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null
      ${script}`,
    ],
    { windowsHide: true },
  );
}
/** Title of the top-level window Windows would deliver a click to at each physical point. */
async function windowsAt(points) {
  const { stdout } = await run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Add-Type -TypeDefinition 'using System;using System.Text;using System.Runtime.InteropServices;public class W{[DllImport("user32.dll")]public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);[StructLayout(LayoutKind.Sequential)]public struct P{public int X;public int Y;}[DllImport("user32.dll")]public static extern IntPtr WindowFromPoint(P p);[DllImport("user32.dll")]public static extern IntPtr GetAncestor(IntPtr h,uint f);[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);public static string At(int x,int y){var p=new P();p.X=x;p.Y=y;var h=GetAncestor(WindowFromPoint(p),2);var s=new StringBuilder(256);GetWindowText(h,s,256);return s.ToString();}}'
      [W]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null
      ${points.map((p) => `[W]::At(${Math.round(p.x)},${Math.round(p.y)})`).join("\n      ")}`,
    ],
    { windowsHide: true },
  );
  return stdout.trim().split(/\r?\n/);
}
/**
 * Real clicks and keys go to whatever window is on top, so refuse to send any
 * unless the fixture itself is under every point the script touches. (On
 * 2026-09-22 a maximized window covered the fixture and the input landed in it.)
 */
async function assertFixtureOnTop(points) {
  const covering = (await windowsAt(points)).filter(
    (title) => title !== "Studio Screen Native Test",
  );
  if (covering.length)
    throw new Error(
      `UNSAFE: "${covering[0]}" covers the test window, so no input was sent.`,
    );
}
async function latestProject(page) {
  return page.evaluate(async () => {
    const { listProjects } = await import("/src/storage.ts");
    const p = (await listProjects()).sort((a, b) => b.updated - a.updated)[0];
    return {
      name: p.name,
      capture: p.capture,
      folder: p.folder,
      duration: p.duration,
      points: p.points,
      activity: p.activity?.length || 0,
    };
  });
}
function decode(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ["-v", "error", ...args, "-"], { windowsHide: true });
    const chunks = [];
    p.stdout.on("data", (c) => chunks.push(c));
    p.on("error", reject);
    p.on("close", () => resolve(Buffer.concat(chunks)));
  });
}
async function videoInfo(file) {
  const { stderr } = await run(ffmpeg, ["-i", file]).catch((e) => e);
  const size = /, (\d{3,5})x(\d{3,5})/.exec(stderr);
  const duration = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr);
  return {
    width: +size[1],
    height: +size[2],
    duration: duration ? +duration[1] * 3600 + +duration[2] * 60 + +duration[3] : 0,
  };
}

const results = {};
try {

// ---- Main take ------------------------------------------------------------
async function mainTake({ cursor }) {
  const { app, page, errors } = await launch(
    cursor ? { STUDIO_TEST_CAPTURE_CURSOR: "1" } : {},
  );
  try {
    const fixture = await openFixture(app);
    const dot = await physical(app, fixture, "#dot");
    const field = await physical(app, fixture, "#field");
    const link = await physical(app, fixture, "#link");
    await startTake(page);
    const bar = await waitForBar(app);
    await page.waitForTimeout(800);
    await assertFixtureOnTop([dot, field, link]);
    const clickedAt = Date.now();
    await input(`
      [T]::SetPhysicalCursorPos(${dot.x},${dot.y}) | Out-Null
      Start-Sleep -Milliseconds 700
      for($i=0;$i -lt 5;$i++){ [T]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 15; [T]::mouse_event(4,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 15 }
      Start-Sleep -Milliseconds 300
      [T]::mouse_event(8,0,0,0,[UIntPtr]::Zero); [T]::mouse_event(16,0,0,0,[UIntPtr]::Zero)
      [T]::keybd_event(27,0,0,[UIntPtr]::Zero); [T]::keybd_event(27,0,2,[UIntPtr]::Zero)
      Start-Sleep -Milliseconds 200
      [T]::mouse_event(0x0800,0,0,-120,[UIntPtr]::Zero)
      Start-Sleep -Milliseconds 200
      [T]::SetPhysicalCursorPos(${field.x},${field.y}) | Out-Null
      Start-Sleep -Milliseconds 300
      [T]::mouse_event(2,0,0,0,[UIntPtr]::Zero); [T]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
      Start-Sleep -Milliseconds 200
      [T]::keybd_event(17,0,0,[UIntPtr]::Zero); [T]::keybd_event(75,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [T]::keybd_event(75,0,2,[UIntPtr]::Zero); [T]::keybd_event(17,0,2,[UIntPtr]::Zero)
      foreach($k in 65,66,67,68){ [T]::keybd_event($k,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 70; [T]::keybd_event($k,0,2,[UIntPtr]::Zero); Start-Sleep -Milliseconds 90 }
      [T]::SetPhysicalCursorPos(${link.x},${link.y}) | Out-Null
      Start-Sleep -Milliseconds 400
      [T]::SetPhysicalCursorPos(${dot.x},${dot.y}) | Out-Null
      Start-Sleep -Milliseconds 300
    `);
    await fixture.evaluate(() => window.flash());
    await page.waitForTimeout(3200);
    await bar.getByRole("button", { name: "Finish" }).click();
    await page.getByText(/Auto-edit:|Recording ready/).waitFor({ timeout: 20000 });
    await page.getByText("Saved locally", { exact: true }).waitFor();
    const project = await latestProject(page);
    const box = await fixture.locator("#dot").boundingBox();
    const size = await fixture.evaluate(() => [innerWidth, innerHeight]);
    return { project, errors, clickedAt, dotFraction: [(box.x + box.width / 2) / size[0], (box.y + box.height / 2) / size[1]] };
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  }
}

const take = await mainTake({ cursor: false });
const video = path.join(take.project.folder, "recording.mp4");
const info = await videoInfo(video);
const points = take.project.points;
const lefts = points.filter((p) => p.click);
// The five-click burst: the first five left clicks.
const burst = lefts.slice(0, 5);
const rgbAt = async (seconds) =>
  decode(["-ss", String(seconds), "-i", video, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24"]);
// Locate the red marker in a frame taken while the pointer rests on it.
const rest = burst[0].t - 0.15;
const frame = await rgbAt(rest);
let sx = 0,
  sy = 0,
  n = 0;
for (let y = 0; y < info.height; y++)
  for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 3;
    if (frame[i] > 200 && frame[i + 1] < 80 && frame[i + 2] < 80) {
      sx += x;
      sy += y;
      n++;
    }
  }
const marker = [sx / n, sy / n];
const click = [burst[0].x * info.width, burst[0].y * info.height];
// Cursor pixels near the marker: anything not blue or red.
function strayPixels(buffer) {
  let stray = 0;
  for (let y = Math.max(0, Math.round(marker[1]) - 10); y < Math.min(info.height, Math.round(marker[1]) + 60); y++)
    for (let x = Math.max(0, Math.round(marker[0]) - 10); x < Math.min(info.width, Math.round(marker[0]) + 50); x++) {
      if (Math.hypot(x - marker[0], y - marker[1]) < 9) continue;
      const i = (y * info.width + x) * 3;
      const [r, g, b] = [buffer[i], buffer[i + 1], buffer[i + 2]];
      const blue = Math.abs(r - 0x2f) < 40 && Math.abs(g - 0x6d) < 40 && Math.abs(b - 0xb5) < 40;
      const red = r > 150 && g < 120 && b < 120;
      if (!blue && !red) stray++;
    }
  return stray;
}
// A/V: first white flash frame vs 1 kHz onset.
const flashRegion = (buffer) => {
  let sum = 0,
    count = 0;
  for (let y = Math.round(info.height * 0.85); y < info.height; y += 4)
    for (let x = Math.round(info.width * 0.85); x < info.width; x += 4) {
      const i = (y * info.width + x) * 3;
      sum += buffer[i];
      count++;
    }
  return sum / count;
};
const fps = 60;
const tail = Math.max(0, info.duration - 3.5);
const clip = await decode(["-ss", String(tail), "-i", video, "-vf", `fps=${fps}`, "-f", "rawvideo", "-pix_fmt", "rgb24"]);
const size = info.width * info.height * 3;
let flashFrame = -1;
for (let f = 0; f < Math.floor(clip.length / size); f++)
  if (flashRegion(clip.subarray(f * size, (f + 1) * size)) > 200) {
    flashFrame = f;
    break;
  }
const pcm = await decode(["-ss", String(tail), "-i", video, "-vn", "-af", audioFilter, "-ac", "1", "-ar", "48000", "-f", "f32le"]);
const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4));
let onset = -1;
for (let i = 0; i + 240 < samples.length; i += 48) {
  let e = 0;
  for (let j = 0; j < 240; j++) e += samples[i + j] * samples[i + j];
  if (Math.sqrt(e / 240) > 0.05) {
    onset = i;
    break;
  }
}
results.main = {
  video: info,
  capture: take.project.capture,
  points: points.length,
  activity: take.project.activity,
  leftClicks: lefts.length,
  burstGapsMs: burst.slice(1).map((p, i) => Math.round((p.t - burst[i].t) * 1000)),
  rightClicks: points.filter((p) => p.right).length,
  wheel: points.filter((p) => p.wheel).length,
  shortcuts: points.filter((p) => p.shortcut).map((p) => p.shortcut),
  typing: points.filter((p) => p.typing).length,
  shapes: [...new Set(points.filter((p) => p.cursor).map((p) => p.cursor))],
  markerPx: marker.map((v) => +v.toFixed(1)),
  clickPx: click.map((v) => +v.toFixed(1)),
  clickErrorPx: +Math.hypot(marker[0] - click[0], marker[1] - click[1]).toFixed(2),
  strayPixels: strayPixels(frame),
  flashSeconds: flashFrame >= 0 ? +(flashFrame / fps).toFixed(3) : null,
  toneSeconds: onset >= 0 ? +(onset / 48000).toFixed(3) : null,
  errors: take.errors,
};
results.main.avOffsetMs =
  results.main.flashSeconds !== null && results.main.toneSeconds !== null
    ? Math.round((results.main.toneSeconds - results.main.flashSeconds) * 1000)
    : null;

// ---- Control: cursor baked in must be detectable ----------------------------
const control = await mainTake({ cursor: true });
const controlVideo = path.join(control.project.folder, "recording.mp4");
const controlFrame = await decode([
  "-ss",
  String(control.project.points.find((p) => p.click).t - 0.15),
  "-i",
  controlVideo,
  "-frames:v",
  "1",
  "-f",
  "rawvideo",
  "-pix_fmt",
  "rgb24",
]);
results.control = { strayPixels: strayPixels(controlFrame) };

// ---- Crash: helper killed mid-take --------------------------------------------
{
  const { app, page } = await launch();
  try {
    await openFixture(app);
    await startTake(page);
    await waitForBar(app);
    await page.waitForTimeout(3500);
    await run("taskkill", ["/IM", "studio-capture.exe", "/F"]).catch(() => {});
    await page.getByText(/Recording stopped unexpectedly/).waitFor({ timeout: 20000 });
    await page.getByText("Saved locally", { exact: true }).waitFor();
    const project = await latestProject(page);
    results.helperKilled = {
      name: project.name,
      projectSeconds: +project.duration.toFixed(2),
      fileSeconds: (await videoInfo(path.join(project.folder, "recording.mp4"))).duration,
    };
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  }
}

// ---- Crash: app killed mid-take, recovered on relaunch -------------------------
{
  const first = await launch();
  await openFixture(first.app);
  await startTake(first.page);
  await waitForBar(first.app);
  await first.page.waitForTimeout(3000);
  const mainPid = await first.app.evaluate(() => process.pid);
  const killedAt = Date.now();
  await run("taskkill", ["/PID", String(mainPid), "/F"]).catch(() => {});
  let helperGoneMs = null;
  for (let i = 0; i < 100; i++) {
    const { stdout } = await run("tasklist", ["/FI", "IMAGENAME eq studio-capture.exe"]);
    if (!stdout.includes("studio-capture.exe")) {
      helperGoneMs = Date.now() - killedAt;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  // Leftover Electron child processes from the killed app.
  await run("taskkill", ["/PID", String(mainPid), "/T", "/F"]).catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));
  const { app, page } = await launch();
  try {
    await page.getByText(/Recovered a recording/).waitFor({ timeout: 20000 });
    await page.getByText("Saved locally", { exact: true }).waitFor();
    const project = await latestProject(page);
    results.appKilled = {
      helperGoneMs,
      name: project.name,
      projectSeconds: +project.duration.toFixed(2),
      points: project.points.length,
    };
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  }
}

await fs.writeFile(path.join(root, "tests/a4-results.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
// Recordings contain the screen; keep only the measurements.
await fs.rm(projects, { recursive: true, force: true });

const m = results.main;
expect(m.errors).toEqual([]);
expect(m.capture).toBe("native");
expect(m.strayPixels).toBeLessThan(5);
expect(results.control.strayPixels).toBeGreaterThan(30);
expect(m.leftClicks).toBeGreaterThanOrEqual(6);
// The injected clicks are ~30 ms apart but PowerShell's sleep is coarse; what
// matters is that all five land.
expect(m.burstGapsMs).toHaveLength(4);
expect(Math.max(...m.burstGapsMs)).toBeLessThan(100);
expect(m.rightClicks).toBe(1);
expect(m.wheel).toBeGreaterThanOrEqual(1);
expect(m.shortcuts).toContain("Ctrl + K");
expect(m.typing).toBeGreaterThanOrEqual(4);
expect(m.shapes).toEqual(expect.arrayContaining(["text", "pointer"]));
expect(m.clickErrorPx).toBeLessThanOrEqual(2);
expect(m.avOffsetMs).not.toBeNull();
expect(Math.abs(m.avOffsetMs)).toBeLessThanOrEqual(20);
expect(results.helperKilled.fileSeconds).toBeGreaterThan(2.5);
expect(results.helperKilled.projectSeconds).toBeGreaterThan(2.5);
expect(results.appKilled.name).toMatch(/^Recovered/);
expect(results.appKilled.projectSeconds).toBeGreaterThan(2);
expect(results.appKilled.helperGoneMs).not.toBeNull();
expect(results.appKilled.helperGoneMs).toBeLessThan(3000);
expect(results.appKilled.projectSeconds).toBeLessThan(6);
console.log("PASS: cursor-free footage, full input events, 2 px click accuracy, A/V sync, crash-safe takes.");
} finally {
  // Also remove captures when fixture/input setup fails before the assertions.
  await fs.rm(projects, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
