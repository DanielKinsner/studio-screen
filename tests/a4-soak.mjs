// A4 soak: record the main display at 60 fps with the capture helper for a long
// stretch (default 30 minutes; `--minutes 5` for a shorter run) and sample the
// helper's memory. Passes when memory after the first minute stays within
// 150 MB. The recording is deleted afterwards; only numbers are kept.
// Uses the GPU encoder for the whole run, so it waits for an idle PC.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);
const root = process.cwd();
const minutes =
  Number(process.argv[process.argv.indexOf("--minutes") + 1]) || 30;
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
      `SKIPPED: the PC was used ${(+stdout.trim()).toFixed(0)} s ago.`,
    );
    process.exit(3);
  }
}
const dir = path.join(root, "tests/.native");
await fs.mkdir(dir, { recursive: true });
const output = path.join(dir, "soak.mp4"),
  events = path.join(dir, "soak.jsonl");
const helper = spawn(
  "native/studio-capture/target/release/studio-capture.exe",
  [
    "record",
    JSON.stringify({
      output,
      events,
      monitor: { x: 100, y: 100 },
      fps: 60,
      audio: true,
    }),
  ],
  { stdio: ["pipe", "pipe", "inherit"] },
);
let last = {};
let startedEvent = {}, pending = "";
helper.stdout.on("data", (d) => {
  pending += String(d);
  const lines = pending.split("\n");
  pending = lines.pop();
  for (const line of lines)
    try {
      const m = JSON.parse(line);
      if (m.event === "started") startedEvent = m;
      if (m.event) last = m;
      if (m.event === "error") console.error(m.message);
    } catch {}
});
const samples = [];
let interrupted = false;
const started = Date.now();
const memory = async () => {
  const { stdout } = await run("powershell.exe", [
    "-NoProfile",
    "-Command",
    `(Get-Process -Id ${helper.pid}).WorkingSet64`,
  ]);
  return Math.round(+stdout.trim() / 1e6);
};
while (Date.now() - started < minutes * 60000) {
  await new Promise((r) => setTimeout(r, 15000));
  const { stdout: idleText } = await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "tests/idle.ps1"]);
  if (!Number.isFinite(Number(idleText.trim())) || Number(idleText.trim()) < 16) {
    interrupted = true;
    console.log("Stopping soak: keyboard or mouse activity resumed.");
    break;
  }
  const mb = await memory().catch(() => null);
  if (mb === null) break;
  samples.push({
    minute: +((Date.now() - started) / 60000).toFixed(2),
    mb,
    frames: last.frames,
    seconds: last.seconds,
  });
  console.log(samples.at(-1));
}
helper.stdin.write("stop\n");
await new Promise((r) => helper.on("exit", r));
const stat = await fs.stat(output).catch(() => ({ size: 0 }));
const settled = samples.filter((s) => s.minute >= 1).map((s) => s.mb);
const result = {
  minutes,
  interrupted,
  frameSize: [startedEvent.width, startedEvent.height],
  fps: startedEvent.fps,
  samples,
  settledMinMb: Math.min(...settled),
  settledMaxMb: Math.max(...settled),
  growthMb: Math.max(...settled) - Math.min(...settled),
  fileMb: Math.round(stat.size / 1e6),
  finalEvent: last,
};
await fs.writeFile(
  path.join(root, "tests/a4-soak-results.json"),
  JSON.stringify(result, null, 2),
);
await fs.rm(output, { force: true });
await fs.rm(events, { force: true });
console.log(JSON.stringify({ ...result, samples: samples.length }, null, 2));
if (interrupted) {
  console.log("SKIPPED: interrupted by PC use; recording deleted, no completed soak result.");
  process.exit(3);
}
if (last.event !== "stopped" || last.seconds < minutes * 60 - 1 || last.frames < minutes * 60 * 60 * 0.99) {
  console.log("FAIL: helper did not complete the requested recording duration at 60 fps.");
  process.exit(1);
}
if (!(result.growthMb <= 150)) {
  console.log("FAIL: helper memory kept growing.");
  process.exit(1);
}
console.log(
  `PASS: ${minutes} min ${result.frameSize.join("×")} at ${result.fps} fps with flat memory (${result.growthMb} MB spread).`,
);
