import type { Point, Project } from "./types";
import { memo, springStep } from "./spring";

/** Stored samples per second; each sample is two 1/240 s simulation steps. */
const RATE = 120;
const SUBSTEPS = 2;
/** Around a click the drawn cursor eases back onto the exact click spot. */
const CLICK_SNAP = 0.12;
const demoClicks = [5, 14];
const demoShortcuts = [
  { t: 6, shortcut: "Ctrl + K" },
  { t: 15, shortcut: "Ctrl + S" },
];

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

/** Index of the last value <= t in an ascending list, or -1. */
export function lastAtOrBefore(values: ArrayLike<number>, t: number) {
  let lo = 0,
    hi = values.length - 1,
    found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

const times = memo((points: Point[]) => Float64Array.from(points, (p) => p.t));

function rawAt(points: Point[], t: number) {
  if (!points.length) return { x: 0.5, y: 0.5 };
  const i = Math.max(0, lastAtOrBefore(times(points), t));
  const a = points[i],
    b = points[Math.min(i + 1, points.length - 1)];
  const k = a.t === b.t ? 0 : clamp((t - a.t) / (b.t - a.t), 0, 1);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/** Recorded pointer position at source time t, linearly interpolated. */
export function pointerAt(p: Project, t: number) {
  if (p.demo)
    return {
      x: 0.47 + 0.2 * Math.sin(t * 0.32),
      y: 0.48 + 0.12 * Math.cos(t * 0.42),
      t,
    };
  return { ...rawAt(p.points, t), t };
}

type Path = { start: number; xs: Float32Array; ys: Float32Array };

const cursorPath = memo((points: Point[], smoothing: number): Path | null => {
  if (points.length < 2 || smoothing <= 0) return null;
  const start = points[0].t,
    end = points[points.length - 1].t;
  const count = Math.ceil((end - start) * RATE) + 1;
  const xs = new Float32Array(count),
    ys = new Float32Array(count);
  const x = { value: points[0].x, velocity: 0 },
    y = { value: points[0].y, velocity: 0 };
  const response = smoothing * 2,
    dt = 1 / (RATE * SUBSTEPS);
  let j = 0;
  xs[0] = x.value;
  ys[0] = y.value;
  for (let i = 1; i < count; i++) {
    for (let step = 1; step <= SUBSTEPS; step++) {
      const t = start + (i - 1) / RATE + step * dt;
      while (j < points.length - 2 && points[j + 1].t <= t) j++;
      const a = points[j],
        b = points[j + 1];
      const k = a.t === b.t ? 0 : clamp((t - a.t) / (b.t - a.t), 0, 1);
      springStep(x, a.x + (b.x - a.x) * k, response, 0, dt);
      springStep(y, a.y + (b.y - a.y) * k, response, 0, dt);
    }
    xs[i] = x.value;
    ys[i] = y.value;
  }
  return { start, xs, ys };
});

type Events = {
  shapeTimes: number[];
  shapes: string[];
  clicks: number[];
  moves: number[];
  shortcuts: { t: number; shortcut: string }[];
  shortcutTimes: number[];
};

const events = memo((points: Point[], demo: boolean): Events => {
  if (demo)
    return {
      shapeTimes: [],
      shapes: [],
      clicks: demoClicks,
      moves: [],
      shortcuts: demoShortcuts,
      shortcutTimes: demoShortcuts.map((s) => s.t),
    };
  const moves: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i],
      b = points[i - 1];
    if (a.click || Math.hypot(a.x - b.x, a.y - b.y) > 0.002) moves.push(a.t);
  }
  const shortcuts = points
    .filter((pt) => pt.shortcut)
    .map((pt) => ({ t: pt.t, shortcut: pt.shortcut! }));
  const shaped = points.filter((pt) => pt.cursor);
  return {
    shapeTimes: shaped.map((pt) => pt.t),
    shapes: shaped.map((pt) => pt.cursor!),
    clicks: points.filter((pt) => pt.click).map((pt) => pt.t),
    moves,
    shortcuts,
    shortcutTimes: shortcuts.map((s) => s.t),
  };
});

/** Smoothed cursor position at source time t; exact at click moments. */
export function smoothPointer(p: Project, t: number) {
  const raw = pointerAt(p, t);
  if (p.demo) return raw;
  const path = cursorPath(p.points, p.settings.cursorSmoothing || 0);
  if (!path) return raw;
  const f = clamp((t - path.start) * RATE, 0, path.xs.length - 1),
    i = Math.floor(f),
    k = f - i,
    n = Math.min(i + 1, path.xs.length - 1);
  let x = path.xs[i] + (path.xs[n] - path.xs[i]) * k,
    y = path.ys[i] + (path.ys[n] - path.ys[i]) * k;
  const { clicks } = events(p.points, p.demo);
  // The closest click within reach is the last one at or before t + CLICK_SNAP,
  // or the one before it when that last click is still ahead of t.
  const c = lastAtOrBefore(clicks, t + CLICK_SNAP);
  const nearest = Math.min(
    c >= 0 ? Math.abs(t - clicks[c]) : Infinity,
    c >= 1 ? Math.abs(t - clicks[c - 1]) : Infinity,
  );
  if (nearest < CLICK_SNAP) {
    const v = 1 - nearest / CLICK_SNAP,
      w = v * v * (3 - 2 * v);
    x += (raw.x - x) * w;
    y += (raw.y - y) * w;
  }
  return { x, y, t };
}

/** Overlay opacity: hidden ranges, idle fade after 1.5 s without movement. */
export function cursorOpacity(p: Project, t: number) {
  if (
    !p.settings.showCursor ||
    p.hiddenCursor?.some((s) => t >= s.start && t < s.end)
  )
    return 0;
  if (!p.settings.cursorIdle || p.demo) return 1;
  const { moves } = events(p.points, p.demo);
  const i = lastAtOrBefore(moves, t);
  const lastMove = i >= 0 ? moves[i] : 0;
  return 1 - clamp((t - lastMove - 1.5) / 0.4, 0, 1);
}

/** Recorded cursor shape at t ("arrow" when unknown). */
export function cursorShapeAt(p: Project, t: number) {
  const { shapeTimes, shapes } = events(p.points, p.demo);
  const i = lastAtOrBefore(shapeTimes, t);
  return i >= 0 ? shapes[i] : "arrow";
}

/** Time of the click whose 0.5 s highlight is showing at t. */
export function clickAt(p: Project, t: number) {
  const { clicks } = events(p.points, p.demo);
  const i = lastAtOrBefore(clicks, t);
  return i >= 0 && t < clicks[i] + 0.5 ? clicks[i] : undefined;
}

/** The most recent shortcut chip still on screen (1.8 s) at t. */
export function shortcutAt(p: Project, t: number) {
  const { shortcuts, shortcutTimes } = events(p.points, p.demo);
  const i = lastAtOrBefore(shortcutTimes, t);
  return i >= 0 && t < shortcuts[i].t + 1.8 ? shortcuts[i] : undefined;
}
