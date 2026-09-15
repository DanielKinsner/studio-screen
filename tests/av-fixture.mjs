// Synthetic only: reproduce the old DPI-dependent flash failure, then check
// the fullscreen sampling filter at both 1440p and 4K. No desktop recording.
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { audioFilter, flashFilter, flashTimes } from "./av-measure.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
function frames(size, draw, filter) {
  return execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i",
    `color=c=black:s=${size}:r=60:d=0.5`, "-vf", `${draw},${filter}`,
    "-f", "rawvideo", "-pix_fmt", "gray", "-"], { windowsHide: true });
}
const old = frames("2560x1440",
  "drawbox=x=0:y=87:w=640:h=360:color=white:t=fill:enable='gte(t,0.1)'",
  "crop=800:400:100:250,scale=32:18");
assert.equal(flashTimes(old).length, 0);
for (const size of ["2560x1440", "3840x2160"]) {
  const corrected = frames(size,
    "drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='gte(t,0.1)'", flashFilter);
  assert.deepEqual(flashTimes(corrected), [0.1]);
}
console.log("PASS: reproduced old 1440p crop missing the flash; fullscreen filter detects the exact onset at 1440p and 4K.");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-av-fixture-"));
try {
  const file = path.join(dir, "gap.mka");
  execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i",
    "aevalsrc=if(gte(t\\,1)\\,0.5*sin(2*PI*1000*t)\\,0):s=48000:d=2",
    "-af", "aselect=not(between(t\\,0.2\\,0.4))", "-c:a", "pcm_f32le", file], { windowsHide: true });
  const onset = (filter) => {
    const pcm = execFileSync(ffmpeg, ["-v", "error", "-i", file,
      ...(filter ? ["-af", filter] : []), "-f", "f32le", "-"], { windowsHide: true });
    for (let i = 0; i < pcm.length; i += 4)
      if (Math.abs(pcm.readFloatLE(i)) > 0.1) return i / 4 / 48000;
  };
  const raw = onset(), timed = onset(audioFilter);
  assert.ok(raw < 0.85, `raw onset ${raw}`);
  assert.ok(Math.abs(timed - 1) < 0.003, `timestamped onset ${timed}`);
  console.log(`PASS: timestamp gap preserved (raw onset ${raw.toFixed(3)} s, measured onset ${timed.toFixed(3)} s, expected 1 s).`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
