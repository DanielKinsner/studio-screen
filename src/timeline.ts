import type { Caption, Project, Zoom } from "./types";
export const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));
export const timecode = (n: number) =>
  `${Math.floor(Math.max(0, n) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(Math.max(0, n) % 60)
    .toString()
    .padStart(2, "0")}`;
export function visibleSegments(p: Project) {
  const cuts = [...p.cuts].sort((a, b) => a.start - b.start);
  const segments: { start: number; end: number }[] = [];
  let cursor = p.trimStart;
  for (const c of cuts) {
    if (c.end <= cursor || c.start >= p.trimEnd) continue;
    if (c.start > cursor)
      segments.push({ start: cursor, end: Math.min(c.start, p.trimEnd) });
    cursor = Math.max(cursor, c.end);
  }
  if (cursor < p.trimEnd) segments.push({ start: cursor, end: p.trimEnd });
  return segments;
}
export function speedAt(p: Project, t: number) {
  return (
    (p.speeds || []).find((s) => t >= s.start && t < s.end)?.rate ||
    p.settings.speed
  );
}
export function playbackSegments(p: Project) {
  return visibleSegments(p).flatMap((segment) => {
    const edges = [
      ...new Set([
        segment.start,
        segment.end,
        ...(p.speeds || [])
          .flatMap((s) => [s.start, s.end])
          .filter((t) => t > segment.start && t < segment.end),
      ]),
    ].sort((a, b) => a - b);
    return edges
      .slice(0, -1)
      .map((start, i) => ({
        start,
        end: edges[i + 1],
        rate: speedAt(p, start + 0.000001),
      }));
  });
}
export function outputDuration(p: Project) {
  return playbackSegments(p).reduce(
    (n, s) => n + (s.end - s.start) / s.rate,
    0,
  );
}
export function sourceTime(p: Project, outputTime: number) {
  let remaining = Math.max(0, outputTime);
  for (const s of playbackSegments(p)) {
    const duration = (s.end - s.start) / s.rate;
    if (remaining < duration - 1e-9) return s.start + remaining * s.rate;
    remaining -= duration;
  }
  return p.trimEnd;
}
export function outputTimeAt(p: Project, t: number) {
  let elapsed = 0;
  for (const s of playbackSegments(p)) {
    if (t <= s.start) return elapsed;
    if (t < s.end) return elapsed + (t - s.start) / s.rate;
    elapsed += (s.end - s.start) / s.rate;
  }
  return elapsed;
}
export function zoomWeight(z: Zoom, t: number, ease = "smooth") {
  const edge = Math.max(
    0.001,
    Math.min(
      ease === "focused" ? 0.35 : ease === "gentle" ? 1.1 : 0.65,
      (z.end - z.start) / 3,
    ),
  );
  const v = clamp(Math.min((t - z.start) / edge, (z.end - t) / edge), 0, 1);
  return ease === "focused" ? 1 - (1 - v) ** 3 : v * v * (3 - 2 * v);
}
export function zoomAt(zooms: Zoom[], t: number) {
  const z = zooms.find((z) => t >= z.start && t <= z.end);
  if (!z) return { scale: 1, x: 0.5, y: 0.5 };
  const smooth = zoomWeight(z, t);
  return { scale: 1 + (z.scale - 1) * smooth, x: z.x, y: z.y };
}
export function autoZooms(p: Project): Zoom[] {
  if (!p.settings.autoZoom) return p.zooms;
  const generated: Zoom[] = [];
  const clicks = p.demo
    ? [
        { t: 5, x: 0.66, y: 0.4 },
        { t: 14, x: 0.4, y: 0.6 },
      ]
    : p.points.filter((pt) => pt.click);
  for (const pt of clicks) {
    if (
      p.dismissedZooms?.includes(`auto-${pt.t}`) ||
      p.zooms.some((z) => z.id === `auto-${pt.t}`) ||
      generated.some((z) => pt.t < z.end + 0.6) ||
      p.zooms.some((z) => pt.t >= z.start - 1 && pt.t <= z.end + 1)
    )
      continue;
    generated.push({
      id: `auto-${pt.t}`,
      start: Math.max(0, pt.t - 0.7),
      end: Math.min(p.duration, pt.t + 3.5),
      x: pt.x,
      y: pt.y,
      scale: p.settings.zoomStrength,
      mode: p.settings.motionMode,
      follow: true,
    });
  }
  return [...p.zooms, ...generated].sort((a, b) => a.start - b.start);
}
export function typingSections(p: Project) {
  const events = p.points.filter((pt) => pt.typing);
  const groups: { start: number; end: number; count: number }[] = [];
  for (const point of events) {
    const last = groups.at(-1);
    if (last && point.t - last.end < 1.4) {
      last.end = point.t;
      last.count++;
    } else groups.push({ start: point.t, end: point.t, count: 1 });
  }
  return groups
    .filter((g) => g.count >= 3 && g.end - g.start >= 0.5)
    .map((g) => ({
      id: crypto.randomUUID(),
      start: Math.max(p.trimStart, g.start - 0.1),
      end: Math.min(p.trimEnd, g.end + 0.4),
      rate: 2,
    }))
    .filter((s) => s.end > s.start);
}
export function captionsSrt(p: Project) {
  const stamp = (t: number) => {
    const ms = Math.round(t * 1000);
    return (
      `${Math.floor(ms / 3600000)
        .toString()
        .padStart(2, "0")}:${Math.floor(ms / 60000) % 60}`.replace(
        /:(\d)$/,
        ":0$1",
      ) +
      `:${(Math.floor(ms / 1000) % 60).toString().padStart(2, "0")},${(ms % 1000).toString().padStart(3, "0")}`
    );
  };
  let i = 0;
  return p.captions
    .flatMap((c) =>
      playbackSegments(p).flatMap((s) => {
        const a = Math.max(c.start, s.start),
          b = Math.min(c.end, s.end);
        return b > a
          ? [
              `${++i}\n${stamp(outputTimeAt(p, a))} --> ${stamp(outputTimeAt(p, b))}\n${c.text}\n`,
            ]
          : [];
      }),
    )
    .join("\n");
}
export function parseSrt(text: string): Caption[] {
  const stamp = (s: string) => {
    const parts = s.trim().replace(",", ".").split(":").map(Number);
    return parts.reduce((a, b) => a * 60 + b, 0);
  };
  return text
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .flatMap((block, i) => {
      const lines = block.trim().split("\n");
      const index = lines.findIndex((l) => l.includes("-->"));
      if (index < 0) return [];
      const [a, b] = lines[index].split("-->");
      const start = stamp(a),
        end = stamp(b.trim().split(/\s/)[0]);
      const value = lines
        .slice(index + 1)
        .join("\n")
        .replace(/<[^>]*>/g, "");
      return Number.isFinite(start) &&
        Number.isFinite(end) &&
        end > start &&
        value
        ? [{ id: `caption-${i}-${Date.now()}`, start, end, text: value }]
        : [];
    });
}
