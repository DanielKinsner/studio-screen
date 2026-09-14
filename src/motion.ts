import type { Project, Zoom } from "./types";
import { autoZooms, clamp, zoomWeight } from "./timeline";
import { smoothPointer } from "./cursorPath";
export {
  pointerAt,
  smoothPointer,
  cursorOpacity,
  clickAt,
  shortcutAt,
} from "./cursorPath";
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
