// Normal desktop recordings export every frame on time (headless Edge; safe
// while the PC is in use). Start `npm run dev` first.
//
// The capture helper writes fragmented MP4 through Windows Media Foundation:
// 0.3 s fragments, a keyframe every 2 s, no per-fragment start time (tfdt), and
// an index at the end (mfra/tfra) that names each keyframe as "sample N of
// fragment X". Reading that index as the fragment's start time put whole
// fragments 100-250 ms late, so exports held a frame for ~0.2 s and then ran
// behind until a later keyframe.
//  - Builds a fixture with exactly that layout. Every frame shows its own frame
//    number as a 9-bit barcode, so any export frame can be traced to its source.
//  - Checks the fixture has the failing shape, and that FFmpeg reads it cleanly.
//  - Checks mediabunny times every fixture frame at n / 60 s.
//  - Exports it whole at 60 and 30 fps, and trimmed mid-fragment at 60 fps, and
//    reads the barcode of every exported frame: each must show exactly the
//    source frame for its time. No held, late or skipped frames.
// `--recording <recording.mp4>` also checks a real helper take's timing
// against FFprobe (no browser needed for that part).
import { chromium } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";

const run = promisify(execFile);
const bin = "C:/Program Files (x86)/Common Files/AutoPod/ffmpeg/bin";
const ffmpeg = process.env.FFMPEG_PATH || `${bin}/ffmpeg.exe`;
const ffprobe = process.env.FFPROBE_PATH || `${bin}/ffprobe.exe`;
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const FPS = 60;
const SECONDS = 8;
const FRAMES = FPS * SECONDS;
const BITS = 9;

// --- MP4 boxes -------------------------------------------------------------
function boxes(buf, start, end, visit) {
  for (let p = start; p + 8 <= end; ) {
    let size = buf.readUInt32BE(p);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(p + 8));
      header = 16;
    } else if (size === 0) size = end - p;
    visit(buf.toString("latin1", p + 4, p + 8), p + header, p + size, p);
    p += size;
  }
}
const box = (type, ...parts) => {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, body]);
};
const u8 = (v) => Buffer.from([v]);
const u32 = (v) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(v);
  return b;
};
const u64 = (v) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(v));
  return b;
};

/**
 * Turn FFmpeg's fragmented MP4 into the helper's layout: hide every tfdt (the
 * box is renamed to `free`, so offsets don't move) and append an mfra whose
 * tfra entries point at each video keyframe by traf, trun and sample number.
 */
function mediaFoundationLayout(buf) {
  const tracks = new Map();
  boxes(buf, 0, buf.length, (type, s, e) => {
    if (type !== "moov") return;
    boxes(buf, s, e, (t2, s2, e2) => {
      if (t2 === "trak") {
        let id, handler;
        boxes(buf, s2, e2, (t3, s3, e3) => {
          if (t3 === "tkhd")
            id = buf.readUInt32BE(s3 + (buf[s3] === 1 ? 20 : 12));
          if (t3 === "mdia")
            boxes(buf, s3, e3, (t4, s4) => {
              if (t4 === "hdlr") handler = buf.toString("latin1", s4 + 8, s4 + 12);
            });
        });
        tracks.set(id, { handler, entries: [], duration: 0, flags: 0 });
      }
      if (t2 === "mvex")
        boxes(buf, s2, e2, (t3, s3) => {
          if (t3 !== "trex") return;
          const track = tracks.get(buf.readUInt32BE(s3 + 4));
          track.duration = buf.readUInt32BE(s3 + 12);
          track.flags = buf.readUInt32BE(s3 + 20);
        });
    });
  });
  let hidden = 0;
  let end = buf.length;
  boxes(buf, 0, buf.length, (type, s, e, start) => {
    if (type === "mfra") end = Math.min(end, start);
    if (type !== "moof") return;
    let trafNumber = 0;
    boxes(buf, s, e, (t2, s2, e2) => {
      if (t2 !== "traf") return;
      trafNumber++;
      let track, time, duration, flags, trunNumber = 0;
      boxes(buf, s2, e2, (t3, s3, e3, start3) => {
        if (t3 === "tfhd") {
          const f = buf.readUInt32BE(s3) & 0xffffff;
          track = tracks.get(buf.readUInt32BE(s3 + 4));
          let o = s3 + 8;
          if (f & 0x1) o += 8;
          if (f & 0x2) o += 4;
          duration = track.duration;
          flags = track.flags;
          if (f & 0x8) (duration = buf.readUInt32BE(o)), (o += 4);
          if (f & 0x10) o += 4;
          if (f & 0x20) flags = buf.readUInt32BE(o);
        }
        if (t3 === "tfdt") {
          time = buf[s3] === 1 ? Number(buf.readBigUInt64BE(s3 + 4)) : buf.readUInt32BE(s3 + 4);
          buf.write("free", start3 + 4, "latin1");
          hidden++;
        }
        if (t3 !== "trun") return;
        trunNumber++;
        const f = buf.readUInt32BE(s3) & 0xffffff;
        const count = buf.readUInt32BE(s3 + 4);
        let o = s3 + 8;
        if (f & 0x1) o += 4;
        let first = null;
        if (f & 0x4) (first = buf.readUInt32BE(o)), (o += 4);
        for (let i = 0; i < count; i++) {
          let d = duration, sf = i === 0 && first !== null ? first : flags;
          if (f & 0x100) (d = buf.readUInt32BE(o)), (o += 4);
          if (f & 0x200) o += 4;
          if (f & 0x400) {
            const v = buf.readUInt32BE(o);
            o += 4;
            if (!(i === 0 && first !== null)) sf = v;
          }
          if (f & 0x800) o += 4;
          const key = !(sf & 0x10000);
          if (key && (track.handler === "vide" || i === 0))
            track.entries.push({ time, moof: start, traf: trafNumber, trun: trunNumber, sample: i + 1 });
          time += d;
        }
      });
    });
  });
  const tfra = [...tracks].map(([id, t]) =>
    box(
      "tfra",
      u32(0x01000000),
      u32(id),
      u32(0), // traf, trun and sample numbers are one byte each
      u32(t.entries.length),
      ...t.entries.map((x) => Buffer.concat([u64(x.time), u64(x.moof), u8(x.traf), u8(x.trun), u8(x.sample)])),
    ),
  );
  const size = tfra.reduce((n, b) => n + b.length, 0) + 8 + 16;
  const mfra = box("mfra", ...tfra, box("mfro", u32(0), u32(size)));
  const video = [...tracks.values()].find((t) => t.handler === "vide");
  return { file: Buffer.concat([buf.subarray(0, end), mfra]), hidden, keyframes: video.entries };
}

// --- Barcodes --------------------------------------------------------------
// Bit k is a white box in cell k of a 3x3 grid; read back at 48x27.
const drawBits = Array.from({ length: BITS }, (_, k) => {
  const x = (k % 3) * 213 + 24;
  const y = Math.floor(k / 3) * 120 + 18;
  return `drawbox=x=${x}:y=${y}:w=165:h=84:color=white:t=fill:enable='mod(floor(n/${2 ** k}),2)'`;
}).join(",");
async function readBarcodes(file) {
  const { stdout } = await run(
    ffmpeg,
    // Passthrough: every stored frame once, never padded to a constant rate.
    ["-v", "error", "-i", file, "-an", "-fps_mode", "passthrough", "-vf", "scale=48:27:flags=area,format=gray", "-f", "rawvideo", "-"],
    { encoding: "buffer", maxBuffer: 1 << 28, windowsHide: true },
  );
  const size = 48 * 27;
  const values = [];
  for (let f = 0; f * size < stdout.length; f++) {
    let n = 0;
    for (let k = 0; k < BITS; k++) {
      const px = stdout[f * size + (Math.floor(k / 3) * 9 + 4) * 48 + (k % 3) * 16 + 8];
      if (px > 128) n += 2 ** k;
    }
    values.push(n);
  }
  return values;
}

// --- Optional: a real helper recording ----------------------------------------
const recordingArg = process.argv.indexOf("--recording");
if (recordingArg > 0) {
  const recording = process.argv[recordingArg + 1];
  const mb = await import("mediabunny");
  const input = new mb.Input({ source: new mb.FilePathSource(recording), formats: mb.ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  const library = [];
  for await (const p of new mb.EncodedPacketSink(track).packets()) library.push(p.timestamp);
  input.dispose();
  const { stdout } = await run(
    ffprobe,
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", recording],
    { maxBuffer: 1 << 26, windowsHide: true },
  );
  const probe = stdout.trim().split(/\r?\n/).map(Number);
  library.sort((a, b) => a - b);
  probe.sort((a, b) => a - b);
  const wrong = library.filter((t, i) => Math.abs(t - probe[i]) > 0.001).length;
  console.log(`Recording: ${library.length} frames, ${wrong} timed differently from FFprobe.`);
  check(library.length === probe.length && wrong === 0, `${recording}: mediabunny mis-times ${wrong} of ${probe.length} frames.`);
}

// --- Fixture -----------------------------------------------------------------
await run(ffmpeg, [
  "-y", "-v", "error",
  "-f", "lavfi", "-i", `color=c=black:s=640x360:r=${FPS}:d=${SECONDS},${drawBits}`,
  "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${SECONDS}`,
  "-c:v", "libx264", "-preset", "ultrafast", "-g", "120", "-keyint_min", "120",
  "-sc_threshold", "0", "-bf", "0", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-shortest",
  // Frames exactly n / 60 s apart, like the helper: without these the AAC
  // lead-in stretches the first video frame.
  "-video_track_timescale", "60000", "-avoid_negative_ts", "disabled",
  "-movflags", "empty_moov+default_base_moof+skip_trailer", "-frag_duration", "300000",
  "tests/native-export-fixture-ffmpeg.mp4",
], { windowsHide: true });
const layout = mediaFoundationLayout(await fs.readFile("tests/native-export-fixture-ffmpeg.mp4"));
await fs.writeFile("tests/native-export-fixture.mp4", layout.file);
const samples = layout.keyframes.map((k) => k.sample);
check(layout.hidden > 0, "The fixture has no tfdt boxes to hide.");
check(
  samples.some((s) => s > 1),
  `Every keyframe starts its fragment (${samples.join(", ")}); the fixture can't reproduce the bug.`,
);
const source = await readBarcodes("tests/native-export-fixture.mp4");
check(
  source.length === FRAMES && source.every((n, i) => n === i),
  `FFmpeg doesn't read the fixture as frames 0-${FRAMES - 1} in order.`,
);

// --- Export ------------------------------------------------------------------
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = { keyframeSamples: samples, cases: [] };
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByText("Saved locally", { exact: true }).waitFor();
  const cases = [
    { name: "Whole take at 60 fps", trimStart: 0, trimEnd: SECONDS, fps: 60 },
    { name: "Whole take at 30 fps", trimStart: 0, trimEnd: SECONDS, fps: 30 },
    { name: "Trimmed mid-fragment at 60 fps", trimStart: 1.9, trimEnd: 7.4, fps: 60 },
  ];
  const out = await page.evaluate(
    async ({ cases, fps }) => {
      const { newProject } = await import("/src/types.ts");
      const { exportProject } = await import("/src/exporter.ts");
      const code = await (await fetch("/src/exporter.ts")).text();
      const mb = await import(/from "([^"]*mediabunny[^"]*)"/.exec(code)[1]);
      const timesOf = async (blob) => {
        const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
        const times = [];
        for await (const p of new mb.EncodedPacketSink(await input.getPrimaryVideoTrack()).packets())
          times.push(p.timestamp);
        input.dispose();
        return times;
      };
      const offGrid = (times) => times.filter((t, i) => Math.abs(t - i / fps) > 1e-6).length;
      // FFmpeg's own file (with tfdt, no mfra) is the control: same frames.
      const control = offGrid(await timesOf(await (await fetch("/tests/native-export-fixture-ffmpeg.mp4")).blob()));
      const video = await (await fetch("/tests/native-export-fixture.mp4")).blob();
      const times = await timesOf(video);
      const mistimed = offGrid(times);
      const exports = [];
      for (const c of cases) {
        const p = newProject(false);
        p.video = video;
        p.duration = times.length / fps;
        p.trimStart = c.trimStart;
        p.trimEnd = c.trimEnd;
        Object.assign(p.settings, { autoZoom: false, showCursor: false, padding: 0, radius: 0, shadow: 0 });
        const blob = await exportProject(p, {
          format: "mp4",
          height: 360,
          fps: c.fps,
          signal: new AbortController().signal,
          progress: () => {},
        });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let s = "";
        for (let i = 0; i < bytes.length; i += 32768)
          s += String.fromCharCode(...bytes.subarray(i, i + 32768));
        exports.push(btoa(s));
      }
      return { frames: times.length, control, mistimed, exports };
    },
    { cases, fps: FPS },
  );
  results.libraryFrames = out.frames;
  results.controlMistimed = out.control;
  results.libraryMistimed = out.mistimed;
  for (const [i, c] of cases.entries()) {
    const file = `tests/native-export-frames-${i + 1}.mp4`;
    await fs.writeFile(file, Buffer.from(out.exports[i], "base64"));
    const shown = await readBarcodes(file);
    let wrong = 0, held = 0, worstLag = 0, first = null;
    shown.forEach((n, j) => {
      const expected = Math.min(FRAMES - 1, Math.round((c.trimStart + j / c.fps) * FPS));
      if (n !== expected) {
        wrong++;
        first ??= `export frame ${j} shows source ${n}, expected ${expected}`;
      }
      if (j > 0 && n === shown[j - 1]) held++;
      worstLag = Math.max(worstLag, expected - n);
    });
    results.cases.push({ ...c, frames: shown.length, wrong, held, worstLagFrames: worstLag, first });
  }
  results.errors = errors;
} finally {
  await browser.close();
  await fs.writeFile("tests/native-export-frames-results.json", JSON.stringify(results, null, 2));
}

check(
  results.controlMistimed === 0,
  `The FFmpeg control file is already mistimed (${results.controlMistimed} frames); the fixture is broken, not the reader.`,
);
check(
  results.libraryMistimed === 0,
  `mediabunny times ${results.libraryMistimed} of ${results.libraryFrames} fixture frames wrongly (keyframe sample numbers ${samples.join(", ")}).`,
);
for (const c of results.cases) {
  check(c.frames === Math.round((c.trimEnd - c.trimStart) * c.fps), `${c.name}: ${c.frames} frames exported.`);
  check(
    c.wrong === 0,
    `${c.name}: ${c.wrong} frames show the wrong source frame (${c.held} held, up to ${c.worstLagFrames} frames late); first: ${c.first}.`,
  );
}
check(results.errors.length === 0, `Page errors: ${results.errors.join(" | ")}`);
console.log(
  `PASS: helper-layout MP4 (keyframes at samples ${samples.join(", ")} of their fragments) exports every frame on time: whole at 60 and 30 fps, and trimmed mid-fragment.`,
);
