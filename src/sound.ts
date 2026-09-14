import type { Project } from "./types";
import { outputTimeAt } from "./timeline";
export function fadeAt(elapsed: number, duration: number, fade: number) {
  return fade > 0
    ? Math.max(0, Math.min(1, elapsed / fade, (duration - elapsed) / fade))
    : 1;
}
export function clickEvents(p: Project) {
  return (p.demo ? [5, 14] : p.points.filter((p) => p.click).map((p) => p.t))
    .filter(
      (t) =>
        t >= p.trimStart &&
        t < p.trimEnd &&
        !p.cuts.some((c) => t >= c.start && t < c.end),
    )
    .map((t) => outputTimeAt(p, t));
}
export function playClick(
  context: AudioContext,
  destination: AudioNode,
  volume: number,
  when = context.currentTime,
) {
  if (volume <= 0) return;
  const osc = context.createOscillator(),
    gain = context.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(1700, when);
  osc.frequency.exponentialRampToValueAtTime(650, when + 0.025);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime((volume / 100) * 0.2, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);
  osc.connect(gain).connect(destination);
  osc.start(when);
  osc.stop(when + 0.04);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}
