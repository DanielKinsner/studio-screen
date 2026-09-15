// A4 frame cadence, measured directly against the capture helper. The sync
// fixture draws a canvas on the screen's own refresh clock (requestAnimation-
// Frame), changing the picture every second refresh: 30 fps content on a
// 60 Hz display. The helper records at 60 fps, so every change must occupy
// exactly two recorded frames: 2,2,2, never 1,3,1,3. Chromium's compositor
// sometimes skips presenting a refresh (Windows then composes nothing, so
// the helper's screen-change log shows a two-slot gap); a skip can cost one
// odd step and is the screen's doing, not the recorder's. The rule is
// therefore: odd steps <= skipped refreshes + 3. STUDIO_CAPTURE_TRACE=1
// keeps every frame stamp in tests/a4-cadence-trace.log. Waits for an idle
// PC (fullscreen window). Silent.
import { _electron as electron } from "@playwright/test";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { waitForExit } from "./process-exit.mjs";

const exec = promisify(execFile);
const run = (file, args, options = {}) => exec(file, args, { windowsHide: true, ...options });
const root = process.cwd();
const ffmpeg = process.env.FFMPEG_PATH || "C:/Program Files (x86)/Common Files/AutoPod/ffmpeg/bin/ffmpeg.exe";
if (!process.argv.includes("--force")) {
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "tests/idle.ps1"]);
  if (+stdout.trim() < 60) {
    console.log(`SKIPPED: the PC was used ${(+stdout.trim()).toFixed(0)} s ago.`);
    process.exit(3);
  }
}
const dir = path.join(root, "tests/.native");
await fs.mkdir(dir, { recursive: true });
const browser = await electron.launch({ args: ["tests/sync-fixture.cjs"], cwd: root });
let helper, helperExit;
const output = path.join(dir, "cadence.mp4"), events = path.join(dir, "cadence.jsonl");
try {
  const page = await browser.firstWindow();
  await page.waitForFunction(() => document.title === "Studio Screen Sync Fixture");
  const fixture = await browser.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const bounds = window.getBounds();
    return { monitor: screen.dipToScreenPoint({ x: bounds.x + Math.round(bounds.width / 2), y: bounds.y + Math.round(bounds.height / 2) }) };
  });
  // Every second refresh the whole picture flips between two very different
  // patterns (band position and colour), so any two consecutive source frames differ.
  await page.setContent(`<body style="margin:0;background:#000;overflow:hidden"><canvas id="c" style="display:block;width:100vw;height:100vh"></canvas>
<script>
  const c = document.getElementById("c"); c.width = 640; c.height = 360; const g = c.getContext("2d");
  let tick = 0; window.__ticks = []; window.__on = false;
  function draw(ts) {
    if (window.__on) {
      const step = Math.floor(tick / 2);
      g.fillStyle = step % 2 ? "#204080" : "#c08020"; g.fillRect(0, 0, 640, 360);
      g.fillStyle = "#fff"; g.fillRect((step * 37) % 600, 0, 40, 360);
      g.font = "120px sans-serif"; g.fillText(String(step % 100), 200, 220);
      window.__ticks.push(ts); tick++;
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
</script></body>`);
  const config = { output, events, monitor: fixture.monitor, fps: 60, audio: false };
  const trace = process.env.STUDIO_CAPTURE_TRACE ? await fs.open(path.join(root, "tests/a4-cadence-trace.log"), "w") : null;
  helper = spawn("native/studio-capture/target/release/studio-capture.exe", ["record", JSON.stringify(config)], { windowsHide: true, stdio: ["pipe", "pipe", trace ? trace.fd : "inherit"] });
  if (trace) helper.on("exit", () => trace.close());
  helperExit = waitForExit(helper);
  helper.stdin.on("error", () => {});
  const stats = [];
  let stopped = null;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Helper did not start in 20 seconds")), 20000);
    helper.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Helper exited before startup: ${code}`)); });
    let pending = "";
    helper.stdout.on("data", (d) => {
      pending += String(d);
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        try {
          const m = JSON.parse(line);
          if (m.event === "started") { clearTimeout(timeout); resolve(); }
          if (m.event === "stats") stats.push(m);
          if (m.event === "stopped") stopped = m;
        } catch {}
      }
    });
  });
  await page.bringToFront();
  await page.waitForTimeout(1500);
  const playStarted = Date.now();
  await page.evaluate(() => { window.__on = true; });
  await page.waitForTimeout(11000);
  const ticks = await page.evaluate(() => { window.__on = false; return window.__ticks; });
  const { stdout: idle } = await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "tests/idle.ps1"]);
  if (!Number.isFinite(Number(idle.trim())) || Number(idle.trim()) < (Date.now() - playStarted) / 1000 - 0.2)
    throw new Error(`INVALID RUN: PC input resumed during capture (idle ${idle.trim()} s); recording discarded.`);
  if (helper.exitCode === null && helper.signalCode === null) helper.stdin.write("stop\n");
  const exit = await helperExit;
  if (exit.code !== 0) throw new Error(`Capture helper failed: ${JSON.stringify(exit)}`);
  await browser.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await browser.close();

  // Source: rAF ticks 16.7 ms apart; a change every 2 ticks. Missed ticks show as gaps > 25 ms.
  const tickGaps = ticks.slice(1).map((t, i) => t - ticks[i]);
  const sourceMisses = tickGaps.filter((g) => g > 25).length;
  // Helper's own view: one "f" event per recorded slot that received a fresh frame.
  const log = (await fs.readFile(events, "utf8")).trim().split(/\r?\n/).map((l) => JSON.parse(l)).filter((e) => e.k === "f");
  const first = log.length ? log[0].t : 0;
  const seen = log.filter((e) => e.t > first + 2 && e.t < first + 10).map((e) => Math.round(e.t * 60));
  const seenGaps = {};
  for (let i = 1; i < seen.length; i++) seenGaps[seen[i] - seen[i - 1]] = (seenGaps[seen[i] - seen[i - 1]] || 0) + 1;
  // The source presents every refresh, so any gap of two or more slots is a refresh it skipped.
  const skipped = Object.entries(seenGaps).reduce((sum, [gap, count]) => sum + (gap >= 2 ? count * (gap - 1) : 0), 0);

  // Recorded pixels: run lengths of identical consecutive frames over the same 8 s (central crop, thumbnails).
  const W = 64, H = 36;
  const frames = await new Promise((resolve) => {
    const p = spawn(ffmpeg, ["-v", "error", "-ss", String(first + 2), "-to", String(first + 10), "-i", output, "-vf", `crop=iw/2:ih/2:iw/4:ih/4,scale=${W}:${H}:flags=area,format=gray`, "-f", "rawvideo", "-"], { windowsHide: true });
    const chunks = [];
    p.stdout.on("data", (c) => chunks.push(c));
    p.on("close", () => resolve(Buffer.concat(chunks)));
  });
  const n = Math.floor(frames.length / (W * H));
  const runs = [];
  let length = 1;
  for (let f = 1; f < n; f++) {
    let s = 0;
    for (let i = 0; i < W * H; i++) s += Math.abs(frames[f * W * H + i] - frames[(f - 1) * W * H + i]);
    if (s / (W * H) < 0.5) length++;
    else { runs.push(length); length = 1; }
  }
  runs.push(length);
  const histogram = {};
  for (const r of runs) histogram[r] = (histogram[r] || 0) + 1;
  const odd = runs.filter((r) => r !== 2).length;
  const result = {
    recordedFrames: n, steps: runs.length, histogram, oddSteps: odd, oddShare: +(odd / runs.length).toFixed(3),
    sourceTicks: ticks.length, sourceMissedTicks: sourceMisses, helperSeenGaps: seenGaps, skippedRefreshes: skipped,
    captured: stopped?.captured ?? stats.at(-1)?.captured ?? null, dropped: stopped?.dropped ?? stats.at(-1)?.dropped ?? null,
    statsTimeline: stats.map((s) => [s.seconds, s.frames, s.captured, s.dropped]),
  };
  await fs.writeFile(path.join(root, "tests/a4-cadence-results.json"), JSON.stringify(result, null, 2));
  console.log(result);
  // The old helper measured 39% odd steps on an unlucky take (Dan's 2026-09-15 15:49 recording).
  // Each missed source tick can cost one odd step; the helper itself may add at most a couple
  // (a clock-drift boundary crossing costs one per crossing).
  if (n < 400 || runs.length < 200) { console.log("FAIL: too few frames or steps; did the canvas animate?"); process.exitCode = 1; }
  else if (result.dropped > (stats[0]?.dropped ?? 0)) { console.log(`FAIL: the helper dropped ${result.dropped - (stats[0]?.dropped ?? 0)} captured frames from its queue after the first second.`); process.exitCode = 1; }
  else if (odd > skipped + 3) { console.log(`FAIL: ${odd} of ${runs.length} steps were not 2 frames long (${JSON.stringify(histogram)}) but the screen skipped only ${skipped} refreshes.`); process.exitCode = 1; }
  else console.log(`PASS: ${runs.length} steps, ${odd} irregular against ${skipped} refreshes the screen skipped; the recorder added none.`);
} finally {
  if (helper && helper.exitCode === null && helper.signalCode === null) { helper.kill(); await waitForExit(helper); }
  await browser.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await browser.close().catch(() => {});
  await fs.rm(output, { force: true });
  await fs.rm(events, { force: true });
}
