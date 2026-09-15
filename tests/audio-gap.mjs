// Actual Media Foundation encoder regression, with synthetic pixels/audio only.
// No screen recording, audio playback, or mouse input. Rust + FFmpeg required.
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const dir = path.resolve("tests/.audio-gap");
fs.mkdirSync(dir, { recursive: true });
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
function measure(mode) {
  const file = path.join(dir, `${mode}.mp4`);
  execFileSync("cargo", ["run", "--quiet", "--release", "--manifest-path", "native/studio-capture/Cargo.toml",
    "--example", "audio-gap-probe", "--", file, mode], { windowsHide: true });
  const pcm = execFileSync(ffmpeg, ["-v", "error", "-i", file, "-vn", "-ac", "1", "-f", "f32le", "-"], { windowsHide: true });
  for (let i = 0; i < pcm.length; i += 4)
    if (Math.abs(pcm.readFloatLE(i)) > 0.05) return i / 4 / 48000;
  throw new Error("No tone found");
}
try {
  const raw = measure("raw"), filled = measure("filled");
  console.log({ expectedSeconds: 1, rawSeconds: raw, filledSeconds: filled });
  assert.ok(Math.abs(raw - 0.92) < 0.003, "control must expose the 80 ms missing gap");
  assert.ok(Math.abs(filled - 1) < 0.003, "scheduled tone must remain at 1 s");
  console.log("PASS: the real AAC encoder preserves eight 10 ms gaps when the helper fills them.");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
