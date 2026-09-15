// The sync fixture fills the display. Sample its central quarter so browser
// borders and monitor resolution do not change the flash threshold.
export const flashFilter = "crop=iw/2:ih/2:iw/4:ih/4,scale=32:18";
// Raw PCM has no timestamps: materialize gaps before measuring sample indices.
export const audioFilter = "aresample=async=1:first_pts=0";

export function flashTimes(frames, fps = 60) {
  const flashes = [];
  let previous = 0;
  for (let f = 0; (f + 1) * 576 <= frames.length; f++) {
    let sum = 0;
    for (let i = 0; i < 576; i++) sum += frames[f * 576 + i];
    const brightness = sum / 576;
    if (brightness > 128 && previous <= 128) flashes.push(f / fps);
    previous = brightness;
  }
  return flashes;
}

export function pairOffsets(flashes, tones) {
  const offsets = flashes.slice(1).map((t) => {
    const tone = tones.find((s) => Math.abs(s - t) < 0.3);
    return tone === undefined ? null : Math.round((tone - t) * 1000);
  }).filter((v) => v !== null);
  return {
    offsetsMs: offsets,
    meanMs: offsets.length ? offsets.reduce((a, b) => a + b, 0) / offsets.length : null,
  };
}
