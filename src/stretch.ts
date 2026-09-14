/**
 * Change audio duration without changing pitch (WSOLA: overlap-add of short
 * windows, each nudged to line up with the previous one's waveform).
 * `rate` 2 plays twice as fast (half the length); 0.5 plays at half speed.
 */
export function stretch(
  channels: Float32Array<ArrayBuffer>[],
  rate: number,
  sampleRate: number,
): Float32Array<ArrayBuffer>[] {
  if (rate === 1) return channels;
  const input = channels[0]?.length || 0;
  const length = Math.round(input / rate);
  const window = Math.max(64, Math.round(0.04 * sampleRate)) & ~1;
  const hop = window / 2;
  const search = Math.round(0.012 * sampleRate);
  const out = channels.map(() => new Float32Array(length));
  if (length === 0 || input < window * 2) {
    // Too short to overlap meaningfully: plain resample of positions.
    channels.forEach((c, ch) => {
      for (let i = 0; i < length; i++)
        out[ch][i] = c[Math.min(input - 1, Math.floor(i * rate))] || 0;
    });
    return out;
  }
  const hann = Float32Array.from(
    { length: window },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / window),
  );
  const weight = new Float32Array(length);
  const mono = channels[0];
  let previous = 0;
  for (let frame = 0; frame * hop < length; frame++) {
    const outStart = frame * hop;
    const nominal = Math.round(outStart * rate);
    let best = Math.min(Math.max(0, nominal), input - window);
    if (frame > 0) {
      // Where the previous window would naturally continue.
      const natural = previous + hop;
      let bestScore = -Infinity;
      const from = Math.max(0, nominal - search),
        to = Math.min(input - window, nominal + search);
      // Coarse search (every 4th offset and sample) keeps long sections fast.
      for (let offset = from; offset <= to; offset += 4) {
        let score = 0;
        for (let i = 0; i < hop; i += 4)
          score += mono[offset + i] * (mono[natural + i] || 0);
        if (score > bestScore) {
          bestScore = score;
          best = offset;
        }
      }
    }
    for (let ch = 0; ch < channels.length; ch++) {
      const source = channels[ch],
        target = out[ch];
      for (let i = 0; i < window && outStart + i < length; i++)
        target[outStart + i] += source[best + i] * hann[i];
    }
    for (let i = 0; i < window && outStart + i < length; i++)
      weight[outStart + i] += hann[i];
    previous = best;
  }
  for (const target of out)
    for (let i = 0; i < length; i++)
      if (weight[i] > 1e-3) target[i] /= weight[i];
  return out;
}
