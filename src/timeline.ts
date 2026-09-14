import type { Caption, Point, Project, Zoom } from "./types";
import { memo } from "./spring";
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
    return edges.slice(0, -1).map((start, i) => ({
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
/** Hold a zoom this long after the last click of a group. */
export const AUTO_HOLD = 2.2;
/** Groups closer than this stay zoomed in instead of zooming out and back. */
const MERGE_GAP = 1.5;
/** Clicks closer than this share one focus change. */
const COALESCE = 0.4;
/** A click inside the middle 60% of the zoomed view does not move the camera. */
const DEADZONE = 0.3;
const demoClicks = [
  { t: 5, x: 0.66, y: 0.4 },
  { t: 14, x: 0.4, y: 0.6 },
];

/** Seconds before a click that the camera starts moving, so it arrives on time. */
export const zoomLead = (response: number) => clamp(0.9 * response, 0.3, 1.2);

/** Where the view centre can sit at this magnification without leaving the frame. */
export const clampCenter = (v: number, scale: number) =>
  clamp(v, 0.5 / scale, 1 - 0.5 / scale);

type Click = { t: number; x: number; y: number };

const generateZooms = memo(
  (
    zooms: Zoom[],
    points: Point[],
    demo: boolean,
    dismissed: string[],
    duration: number,
    scale: number,
    response: number,
    mode: "2d" | "3d",
  ): Zoom[] => {
    const lead = zoomLead(response);
    const clicks: Click[] = (
      demo ? demoClicks : points.filter((pt) => pt.click)
    )
      // Clicks inside a hand-placed zoom belong to that zoom.
      .filter(
        (c) => !zooms.some((z) => c.t >= z.start - 1 && c.t <= z.end + 1),
      );
    const groups: Click[][] = [];
    for (const c of clicks) {
      const last = groups.at(-1);
      if (
        last &&
        c.t - lead - (last[last.length - 1].t + AUTO_HOLD) < MERGE_GAP
      )
        last.push(c);
      else groups.push([c]);
    }
    const generated = groups.flatMap((group): Zoom[] => {
      const id = `auto-${group[0].t}`;
      if (dismissed.includes(id) || zooms.some((z) => z.id === id)) return [];
      const focus: (Click & { click: number })[] = [];
      for (const c of group) {
        const prev = focus.at(-1);
        if (prev) {
          const dx = clampCenter(c.x, scale) - clampCenter(prev.x, scale),
            dy = clampCenter(c.y, scale) - clampCenter(prev.y, scale);
          if (
            Math.abs(dx) < DEADZONE / scale &&
            Math.abs(dy) < DEADZONE / scale
          )
            continue;
          if (c.t - prev.click < COALESCE) {
            prev.x = c.x;
            prev.y = c.y;
            continue;
          }
        }
        focus.push({ t: Math.max(0, c.t - lead), x: c.x, y: c.y, click: c.t });
      }
      return [
        {
          id,
          start: Math.max(0, group[0].t - lead),
          end: Math.min(duration, group[group.length - 1].t + AUTO_HOLD),
          x: focus[0].x,
          y: focus[0].y,
          scale,
          mode,
          follow: true,
          focus: focus.map(({ t, x, y }) => ({ t, x, y })),
        },
      ];
    });
    return [...zooms, ...generated].sort((a, b) => a.start - b.start);
  },
);

/** Hand-placed zooms plus zooms generated from grouped clicks. */
export function autoZooms(p: Project): Zoom[] {
  if (!p.settings.autoZoom) return p.zooms;
  return generateZooms(
    p.zooms,
    p.points,
    p.demo,
    p.dismissedZooms || [],
    p.duration,
    p.settings.zoomStrength,
    p.settings.cameraResponse,
    p.settings.motionMode,
  );
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
