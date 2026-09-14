import type { Project, Zoom } from "./types";
import { autoZooms, clamp, zoomWeight } from "./timeline";
export function pointerAt(p: Project, t: number) {
  if (p.demo)
    return {
      x: 0.47 + 0.2 * Math.sin(t * 0.32),
      y: 0.48 + 0.12 * Math.cos(t * 0.42),
      t,
    };
  const points = p.points;
  if (!points.length) return { x: 0.5, y: 0.5, t };
  let lo = 0,
    hi = points.length - 1;
  while (lo < hi) {
    const m = Math.ceil((lo + hi) / 2);
    if (points[m].t <= t) lo = m;
    else hi = m - 1;
  }
  const a = points[lo],
    b = points[Math.min(lo + 1, points.length - 1)];
  const k = a.t === b.t ? 0 : clamp((t - a.t) / (b.t - a.t), 0, 1);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, t };
}
export function smoothPointer(p: Project, t: number) {
  const delay = p.settings.cursorSmoothing || 0;
  if (!delay) return pointerAt(p, t);
  const a = pointerAt(p, t),
    b = pointerAt(p, Math.max(0, t - delay)),
    c = pointerAt(p, Math.max(0, t - delay * 2));
  return {
    x: a.x * 0.5 + b.x * 0.3 + c.x * 0.2,
    y: a.y * 0.5 + b.y * 0.3 + c.y * 0.2,
    t,
  };
}
export function cursorOpacity(p: Project, t: number) {
  if (
    !p.settings.showCursor ||
    p.hiddenCursor?.some((s) => t >= s.start && t < s.end)
  )
    return 0;
  if (!p.settings.cursorIdle || p.demo) return 1;
  let lastMove = 0;
  for (let i = p.points.length - 1; i > 0; i--) {
    const a = p.points[i],
      b = p.points[i - 1];
    if (a.t > t) continue;
    if (a.click || Math.hypot(a.x - b.x, a.y - b.y) > 0.002) {
      lastMove = a.t;
      break;
    }
  }
  return 1 - clamp((t - lastMove - 1.5) / 0.4, 0, 1);
}
export function cameraAt(p: Project, t: number) {
  const z = autoZooms(p).find((z) => t >= z.start && t <= z.end);
  if (!z) return { scale: 1, x: 0.5, y: 0.5 };
  const weight = zoomWeight(z, t, p.settings.motionEase);
  let { x, y } = z;
  if (
    p.settings.followCursor &&
    z.follow !== false &&
    (p.demo || p.points.length)
  ) {
    const pt = smoothPointer(p, t);
    x = clamp(x + (pt.x - x) * 0.65, 0, 1);
    y = clamp(y + (pt.y - y) * 0.65, 0, 1);
  }
  return { scale: 1 + (z.scale - 1) * weight, x, y };
}
export type Pose = {
  x: number;
  y: number;
  z: number;
  offsetX: number;
  offsetY: number;
  perspective: number;
  scale: number;
};
export function poseAt(p: Project, t: number): Pose {
  const z = autoZooms(p).find((z) => t >= z.start && t <= z.end);
  const base = {
    x: 0,
    y: 0,
    z: 0,
    offsetX: 0,
    offsetY: 0,
    perspective: 45,
    scale: 1,
  };
  if (!z || (z.mode || p.settings.motionMode) !== "3d") return base;
  const k = zoomWeight(z, t, p.settings.motionEase),
    follow = z.follow !== false && (p.demo || p.points.length > 0),
    pt = smoothPointer(p, t);
  const amount = p.settings.motionIntensity;
  return {
    x: (follow ? (pt.y - 0.5) * amount * 1.6 : (z.tiltX ?? -10)) * k,
    y: (follow ? -(pt.x - 0.5) * amount * 1.6 : (z.tiltY ?? 18)) * k,
    z: (z.tiltZ ?? -2) * k,
    offsetX: (z.offsetX || 0) * k,
    offsetY: (z.offsetY || 0) * k,
    perspective: z.perspective || 45,
    scale: 1 + 0.025 * k,
  };
}
export const tiltPresets: { name: string; value: Partial<Zoom> }[] = [
  { name: "Left", value: { tiltX: -8, tiltY: 22, tiltZ: -3 } },
  { name: "Right", value: { tiltX: -8, tiltY: -22, tiltZ: 3 } },
  { name: "Overhead", value: { tiltX: 25, tiltY: 0, tiltZ: 0 } },
  { name: "Hero", value: { tiltX: -16, tiltY: 24, tiltZ: -5 } },
];
