// Mapping between points of the recording and pixels of the preview, for the
// focus dot and aim view. Same math as the compositor: the 2D camera
// transform, then (for 3D) the perspective projection with its fit-to-frame.
import type { Project, Zoom } from "./types";
import { cameraAt, poseAt, type Pose } from "./camera";
import {
  FIT_MARGIN,
  fitScale,
  project,
  unproject,
  type CardRect,
} from "./perspective";
import { clamp, clampCenter } from "./timeline";

/** Where the recording's card sits on the canvas, in canvas pixels. */
export type Card = { fx: number; fy: number; fw: number; fh: number };
export type View = { width: number; height: number; card: Card };

const is3d = (pose: Pose) =>
  Math.abs(pose.x) +
    Math.abs(pose.y) +
    Math.abs(pose.z) +
    Math.abs(pose.offsetX) +
    Math.abs(pose.offsetY) >
  0.001;

const layerRect = ({ width: w, height: h, card }: View): CardRect => ({
  left: (2 * card.fx) / w - 1,
  right: (2 * (card.fx + card.fw)) / w - 1,
  top: 1 - (2 * card.fy) / h,
  bottom: 1 - (2 * (card.fy + card.fh)) / h,
});

function camera2d(p: Project, t: number, card: Card) {
  const zoom = cameraAt(p, t);
  const scale = zoom.scale * (1 + p.settings.crop / 100);
  const zx = clamp(zoom.x * card.fw * scale - card.fw / 2, 0, card.fw * (scale - 1));
  const zy = clamp(zoom.y * card.fh * scale - card.fh / 2, 0, card.fh * (scale - 1));
  return { scale, left: card.fx - zx, top: card.fy - zy };
}

/**
 * Where a point of the recording (u, v from 0 to 1) is drawn on the preview
 * canvas at time t, in canvas pixels. `flat` ignores the camera (aim view).
 */
export function toPreview(
  p: Project,
  t: number,
  u: number,
  v: number,
  view: View,
  flat = false,
) {
  const { card, width: w, height: h } = view;
  if (flat) return { x: card.fx + u * card.fw, y: card.fy + v * card.fh };
  const cam = camera2d(p, t, card);
  const x = cam.left + u * card.fw * cam.scale,
    y = cam.top + v * card.fh * cam.scale;
  const pose = poseAt(p, t);
  if (!is3d(pose)) return { x, y };
  const fit = fitScale(pose, w / h, FIT_MARGIN, layerRect(view));
  const q = project(pose, w / h, (2 * x) / w - 1, 1 - (2 * y) / h, fit);
  return { x: ((q.x + 1) / 2) * w, y: ((1 - q.y) / 2) * h };
}

/** The point of the recording shown at a canvas pixel (inverse of toPreview). */
export function fromPreview(
  p: Project,
  t: number,
  x: number,
  y: number,
  view: View,
  flat = false,
) {
  const { card, width: w, height: h } = view;
  if (flat) return { u: (x - card.fx) / card.fw, v: (y - card.fy) / card.fh };
  const pose = poseAt(p, t);
  let lx = x,
    ly = y;
  if (is3d(pose)) {
    const fit = fitScale(pose, w / h, FIT_MARGIN, layerRect(view));
    const q = unproject(pose, w / h, (2 * x) / w - 1, 1 - (2 * y) / h, fit);
    lx = ((q.x + 1) / 2) * w;
    ly = ((1 - q.y) / 2) * h;
  }
  const cam = camera2d(p, t, card);
  return {
    u: (lx - cam.left) / (card.fw * cam.scale),
    v: (ly - cam.top) / (card.fh * cam.scale),
  };
}

/** The focus point a zoom aims at, at time t: its active keyframe, else its own point. */
export function focusAt(z: Zoom, t: number) {
  if (z.focus?.length) {
    let key = 0;
    for (let i = z.focus.length - 1; i >= 0; i--)
      if (z.focus[i].t <= t) {
        key = i;
        break;
      }
    return { x: z.focus[key].x, y: z.focus[key].y, key };
  }
  return { x: z.x, y: z.y, key: -1 };
}

/** Move a zoom's focus: the given keyframe (the first also moves the zoom's own point). */
export function aimZoom(z: Zoom, key: number, x: number, y: number): Zoom {
  x = clamp(x, 0, 1);
  y = clamp(y, 0, 1);
  if (key < 0 || !z.focus?.[key]) return { ...z, x, y };
  const focus = z.focus.map((f, i) => (i === key ? { ...f, x, y } : f));
  return key === 0 ? { ...z, focus, x, y } : { ...z, focus };
}

/** The part of the recording a zoom shows at this magnification (0–1 units). */
export function zoomArea(x: number, y: number, scale: number) {
  const s = Math.max(1, scale);
  return {
    left: clampCenter(x, s) - 0.5 / s,
    top: clampCenter(y, s) - 0.5 / s,
    width: 1 / s,
    height: 1 / s,
  };
}
