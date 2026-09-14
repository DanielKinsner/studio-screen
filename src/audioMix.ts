import type { Project } from "./types";
import { outputDuration, playbackSegments } from "./timeline";
import { clickEvents, fadeAt, playClick } from "./sound";
import { stretch } from "./stretch";

/** A stretch of source audio placed into an output window. */
export type Piece = {
  /** Seconds from the start of the output window. */
  at: number;
  /** Output seconds covered. */
  length: number;
  /** Source seconds. */
  from: number;
  to: number;
  rate: number;
};

/** Which source audio plays during output time [u0, u1). */
export function sourcePieces(p: Project, u0: number, u1: number): Piece[] {
  const pieces: Piece[] = [];
  let out = 0;
  for (const g of playbackSegments(p)) {
    const length = (g.end - g.start) / g.rate;
    const a = Math.max(u0, out),
      b = Math.min(u1, out + length);
    if (b > a + 1e-9)
      pieces.push({
        at: a - u0,
        length: b - a,
        from: g.start + (a - out) * g.rate,
        to: g.start + (b - out) * g.rate,
        rate: g.rate,
      });
    out += length;
    if (out >= u1) break;
  }
  return pieces;
}

/** Fade gain as [seconds from u0, gain] points joined by straight lines. */
export function fadePoints(
  total: number,
  fade: number,
  u0: number,
  u1: number,
): [number, number][] {
  const edges = [u0, u1, ...(fade > 0 ? [fade, total - fade, total / 2] : [])]
    .filter((t) => t >= u0 && t <= u1)
    .sort((a, b) => a - b)
    .filter((t, i, list) => i === 0 || t - list[i - 1] > 1e-9);
  return edges.map((t) => [t - u0, fadeAt(t, total, fade)]);
}

export type Pcm = {
  sampleRate: number;
  channels: Float32Array<ArrayBuffer>[];
};
/** Reads decoded source audio for source seconds [from, to). */
export type PcmReader = (from: number, to: number) => Promise<Pcm | null>;

function automate(
  param: AudioParam,
  level: number,
  points: [number, number][],
) {
  param.setValueAtTime(level * points[0][1], 0);
  for (const [at, gain] of points.slice(1))
    param.linearRampToValueAtTime(level * gain, at);
}

/**
 * Mix the edited soundtrack for output seconds [u0, u1): source audio (with
 * cuts, pitch-preserving speed changes and fades), looping music, click sounds.
 */
export async function renderAudioChunk(
  p: Project,
  u0: number,
  u1: number,
  sources: { readSource?: PcmReader; music?: AudioBuffer; sampleRate: number },
): Promise<AudioBuffer> {
  const { sampleRate } = sources;
  const context = new OfflineAudioContext(
    2,
    Math.max(1, Math.round((u1 - u0) * sampleRate)),
    sampleRate,
  );
  const s = p.settings,
    total = outputDuration(p);
  if (sources.readSource && s.volume > 0) {
    const gain = context.createGain();
    automate(
      gain.gain,
      s.volume / 100,
      fadePoints(total, s.sourceFade, u0, u1),
    );
    gain.connect(context.destination);
    for (const piece of sourcePieces(p, u0, u1)) {
      const pcm = await sources.readSource(piece.from, piece.to);
      if (!pcm?.channels[0]?.length) continue;
      const channels =
        piece.rate === 1
          ? pcm.channels
          : stretch(pcm.channels, piece.rate, pcm.sampleRate);
      if (!channels[0].length) continue;
      const buffer = context.createBuffer(
        channels.length,
        channels[0].length,
        pcm.sampleRate,
      );
      channels.forEach((c, i) => buffer.copyToChannel(c, i));
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.connect(gain);
      node.start(piece.at);
    }
  }
  if (sources.music && s.musicVolume > 0) {
    const gain = context.createGain();
    automate(
      gain.gain,
      s.musicVolume / 100,
      fadePoints(total, s.musicFade, u0, u1),
    );
    gain.connect(context.destination);
    const node = context.createBufferSource();
    node.buffer = sources.music;
    node.loop = true;
    node.connect(gain);
    node.start(0, u0 % sources.music.duration);
  }
  if (s.clickVolume > 0)
    for (const click of clickEvents(p))
      if (click >= u0 && click < u1)
        playClick(context, context.destination, s.clickVolume, click - u0);
  return context.startRendering();
}
