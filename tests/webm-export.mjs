// Browser recordings export every frame (headless Edge; safe while the PC is in
// use). Start `npm run dev` first.
//  - Records a 6 s WebM exactly the way browser capture does (MediaRecorder,
//    one-second chunks, duration added by finalizeWebm) from a canvas whose
//    centre changes colour each second, plus a quiet tone. Such files have no
//    cue index and keyframes seconds apart, so most chunks hold no keyframe;
//    the test checks the fixture has that shape, since that is what made
//    mediabunny's lookup by time come back empty.
//  - Exports the whole take, and a trim that starts mid-chunk, to MP4.
//  - Every second of each export must show that second's colour, never the
//    empty card (#eff0ea).
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";

const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByText("Saved locally", { exact: true }).waitFor();
  const results = await page.evaluate(async () => {
    const { videoMime } = await import("/src/media.ts");
    const { finalizeWebm } = await import("/src/webm.ts");
    const { newProject } = await import("/src/types.ts");
    const { exportProject } = await import("/src/exporter.ts");
    const source = await (await fetch("/src/exporter.ts")).text();
    const mb = await import(/from "([^"]*mediabunny[^"]*)"/.exec(source)[1]);
    const colours = [
      [230, 30, 30],
      [30, 200, 60],
      [40, 60, 230],
      [240, 220, 30],
      [220, 40, 220],
      [30, 210, 220],
    ];

    // The fixture: same recorder settings as capture() in src/media.ts.
    const canvas = Object.assign(document.createElement("canvas"), {
      width: 640,
      height: 360,
    });
    const ctx = canvas.getContext("2d");
    // Sound matters: with an audio track the recorder starts a chunk every
    // second, so most chunks hold no video keyframe (video-only recordings
    // start a chunk at each keyframe instead).
    const audio = new AudioContext();
    await audio.resume();
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    gain.gain.value = 0.1;
    const sound = audio.createMediaStreamDestination();
    tone.connect(gain).connect(sound);
    tone.start();
    const mimeType = videoMime("webm");
    const recorder = new MediaRecorder(
      new MediaStream([
        ...canvas.captureStream(30).getVideoTracks(),
        ...sound.stream.getAudioTracks(),
      ]),
      { mimeType, videoBitsPerSecond: 16000000 },
    );
    const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    let started = 0;
    const paint = () => {
      const second = started
        ? Math.floor((performance.now() - started) / 1000)
        : 0;
      // Small changes, like a real screen: a whole-frame colour change makes
      // the encoder add a keyframe, and then the bug doesn't show.
      ctx.fillStyle = "#556070";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const [r, g, b] = colours[Math.min(second, colours.length - 1)];
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(240, 135, 160, 90);
      // A moving bar keeps every frame different.
      ctx.fillStyle = "#000";
      ctx.fillRect((performance.now() / 5) % canvas.width, 0, 8, 40);
    };
    paint();
    const timer = setInterval(paint, 1000 / 30);
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    started = performance.now();
    recorder.start(1000);
    await new Promise((r) => setTimeout(r, colours.length * 1000));
    recorder.stop();
    await stopped;
    clearInterval(timer);
    await audio.close();
    const duration = colours.length;
    const video = await finalizeWebm(
      new Blob(chunks, { type: mimeType }),
      duration * 1000,
    );

    const input = new mb.Input({
      source: new mb.BlobSource(video),
      formats: mb.ALL_FORMATS,
    });
    const track = await input.getPrimaryVideoTrack();
    const hasAudio = !!(await input.getPrimaryAudioTrack());
    const keys = [];
    for await (const packet of new mb.EncodedPacketSink(track).packets())
      if (packet.type === "key") keys.push(+packet.timestamp.toFixed(3));
    // For the record: how many mid-second frames mediabunny's lookup by time
    // can't find in this file (the exporter must not depend on it).
    let lookupMisses = 0;
    const times = colours.map((_, i) => i + 0.5);
    for await (const s of new mb.VideoSampleSink(track).samplesAtTimestamps(
      times,
    )) {
      if (!s) lookupMisses++;
      s?.close();
    }
    input.dispose();

    const centre = async (blob, times) => {
      const out = new mb.Input({
        source: new mb.BlobSource(blob),
        formats: mb.ALL_FORMATS,
      });
      const sink = new mb.VideoSampleSink(await out.getPrimaryVideoTrack());
      const probe = document.createElement("canvas");
      const pixels = [];
      for (const t of times) {
        const sample = await sink.getSample(t);
        if (!sample) {
          pixels.push(null);
          continue;
        }
        probe.width = sample.displayWidth;
        probe.height = sample.displayHeight;
        const c = probe.getContext("2d", { willReadFrequently: true });
        c.drawImage(sample.toCanvasImageSource(), 0, 0);
        sample.close();
        pixels.push([
          ...c.getImageData(probe.width >> 1, probe.height >> 1, 1, 1).data,
        ].slice(0, 3));
      }
      out.dispose();
      return pixels;
    };
    const exportCase = async (name, trimStart, trimEnd) => {
      const p = newProject(false);
      p.name = name;
      p.video = video;
      p.duration = duration;
      p.trimStart = trimStart;
      p.trimEnd = trimEnd;
      p.settings.autoZoom = false;
      p.settings.showCursor = false;
      const blob = await exportProject(p, {
        format: "mp4",
        height: 720,
        fps: 30,
        signal: new AbortController().signal,
        progress: () => {},
      });
      // The middle of each exported second, and the source second it shows.
      const checks = [];
      for (let t = 0.5; t < trimEnd - trimStart; t += 1)
        checks.push({ t, second: Math.floor(trimStart + t) });
      const pixels = await centre(
        blob,
        checks.map((c) => c.t),
      );
      return {
        name,
        bytes: blob.size,
        frames: checks.map((c, i) => ({
          ...c,
          expected: colours[c.second],
          got: pixels[i],
        })),
      };
    };
    return {
      mimeType,
      fixtureBytes: video.size,
      hasAudio,
      keys,
      lookupMisses,
      cases: [
        await exportCase("Whole take", 0, duration),
        await exportCase("Trim starting mid-chunk", 1.25, 5.75),
      ],
    };
  });
  await fs.writeFile(
    "tests/webm-export-results.json",
    JSON.stringify({ ...results, errors }, null, 2),
  );

  // The fixture must look like a real browser recording with sound: an audio
  // track, and keyframes further apart than its one-second chunks.
  const gaps = results.keys.slice(1).map((t, i) => t - results.keys[i]);
  check(results.hasAudio, "The fixture recorded no audio track.");
  check(
    results.keys.length < 6 && (gaps.length === 0 || Math.max(...gaps) > 1.5),
    `Fixture keyframes are too close together to reproduce the bug: ${results.keys.join(", ")}`,
  );
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 45);
  const card = [0xef, 0xf0, 0xea];
  for (const c of results.cases)
    for (const f of c.frames) {
      check(f.got, `${c.name}: no frame decoded at ${f.t} s of the export.`);
      check(
        !near(f.got, card),
        `${c.name}: ${f.t} s of the export shows the empty card instead of the recording.`,
      );
      check(
        near(f.got, f.expected),
        `${c.name}: ${f.t} s shows rgb(${f.got}), expected second ${f.second}'s rgb(${f.expected}).`,
      );
    }
  check(errors.length === 0, `Page errors: ${errors.join(" | ")}`);
  console.log(
    `PASS: browser-recorded WebM (keyframes at ${results.keys.join(", ")} s) exports every second's picture, whole and trimmed mid-chunk.`,
  );
} finally {
  await browser.close();
}
