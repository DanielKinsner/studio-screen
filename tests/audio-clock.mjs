// Real-device audio clock check, silent and headless: plays digital silence so
// the loopback runs, logs 20 s of packets with the helper's own capture code,
// and asserts the current alignment keeps every captured sample (the pre-fix
// arithmetic lost ~12-27 a second to timestamp jitter, so audio ran fast).
// No screen recording, no audible sound, no mouse or keys. Rust + FFmpeg required.
import { execFileSync, spawn } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffplay = path.join(path.dirname(ffmpeg), path.basename(ffmpeg).replace(/ffmpeg/i, "ffplay"));
const dir = path.resolve("tests/.audio-clock");
fs.mkdirSync(dir, { recursive: true });
const seconds = 20;
execFileSync("cargo", ["build", "--quiet", "--release", "--manifest-path", "native/studio-capture/Cargo.toml", "--example", "audio-clock-probe"], { windowsHide: true, stdio: "inherit" });
const silence = spawn(ffplay, ["-nodisp", "-loglevel", "error", "-autoexit", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(seconds + 10)], { windowsHide: true, stdio: "ignore" });
try {
  await new Promise((r) => setTimeout(r, 2000));
  const out = execFileSync("native/studio-capture/target/release/examples/audio-clock-probe.exe", [String(seconds), path.join(dir, "packets.csv")], { windowsHide: true }).toString();
  console.log(out.trim());
  const ratio = Number(/ratio=([\d.]+)/.exec(out)[1]);
  const [, written, dropped, filled] = /new align replay: written=(\d+) dropped=(\d+) filled=(\d+)/.exec(out).map(Number);
  const packets = fs.readFileSync(path.join(dir, "packets.csv"), "utf8").trim().split(/\r?\n/).slice(1).map((l) => l.split(",").map(Number));
  const captured = packets.reduce((s, [, n]) => s + n, 0);
  assert.ok(packets.length > seconds * 50, `only ${packets.length} packets; is the default output device active?`);
  assert.equal(dropped, 0, "alignment dropped samples");
  assert.equal(written, captured, "written samples must equal captured samples");
  // The only legitimate fill is the lead-in before the first packet arrives.
  assert.ok(filled <= 48000 * 0.2, `filled ${filled} samples`);
  assert.ok(Math.abs(ratio - 1) < 0.001, `device clock ratio ${ratio}`);
  console.log(`PASS: ${captured} captured samples all kept over ${seconds} s; device clock ${ratio.toFixed(7)} of QPC.`);
} finally {
  silence.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
