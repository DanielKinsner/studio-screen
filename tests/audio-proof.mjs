import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
const ffmpeg = process.env.FFMPEG_PATH || 'C:/Program Files (x86)/Common Files/AutoPod/ffmpeg/bin/ffmpeg.exe';
function analyze(file) {
  const result = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 20 * 1024 * 1024, windowsHide: true });
  if (result.status !== 0 || result.stderr.length) throw new Error(`${file}: ${result.stderr}`);
  const buf = result.stdout; const samples = new Float32Array(buf.length / 4); for (let i = 0; i < samples.length; i++) samples[i] = buf.readFloatLE(i * 4);
  const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length); if (rms < .001) throw new Error(`${file}: audio is silent`);
  const n = Math.min(16000, samples.length), start = Math.min(4000, samples.length - n); let best = { hz: 0, power: 0 };
  for (let hz = 380; hz <= 500; hz++) { let re = 0, im = 0; for (let i = 0; i < n; i++) { const v = samples[start + i] * (.5 - .5 * Math.cos(2 * Math.PI * i / (n - 1))); re += v * Math.cos(2 * Math.PI * hz * i / 8000); im -= v * Math.sin(2 * Math.PI * hz * i / 8000); } const power = re * re + im * im; if (power > best.power) best = { hz, power }; }
  if (Math.abs(best.hz - 440) > 2) throw new Error(`${file}: expected 440 Hz internal test tone, found ${best.hz}`);
  return { file, decodedSeconds: samples.length / 8000, rmsDb: 20 * Math.log10(rms), dominantHz: best.hz };
}
const customFiles = process.argv.slice(2);
const results = (customFiles.length ? customFiles : ['tests/native-capture.webm', 'tests/native-export.webm']).map(analyze);
if (results.length > 1 && Math.abs(results[0].rmsDb - results[1].rmsDb) > 1) throw new Error('Export changed source audio by more than 1 dB.');
await fs.writeFile(`tests/${customFiles.length ? 'portable-audio' : 'audio'}-results.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
console.log(customFiles.length ? 'PASS: actual internal 440 Hz tone present in supplied media, no decoder errors.' : 'PASS: real 440 Hz system audio survives capture and composed export, less than 1 dB level difference, no decoder errors.');
