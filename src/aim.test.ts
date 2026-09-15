import { describe, expect, it } from "vitest";
import { aimZoom, focusAt, fromPreview, toPreview, zoomArea, type View } from "./aim";
import { project, unproject, fitScale, FIT_MARGIN } from "./perspective";
import type { Pose } from "./camera";
import { newProject, type Project, type Zoom } from "./types";

const view: View = {
  width: 1600,
  height: 900,
  card: { fx: 72, fy: 72, fw: 1456, fh: 756 },
};
function withZoom(zoom: Partial<Zoom>): Project {
  const p = newProject(false);
  p.duration = 12;
  p.trimEnd = 12;
  p.settings.autoZoom = false;
  p.settings.followCursor = false;
  p.zooms = [
    { id: "z", start: 1, end: 9, x: 0.3, y: 0.4, scale: 2, mode: "2d", ...zoom },
  ];
  return p;
}

describe("Perspective inverse", () => {
  it("undoes the projection for any pose", () => {
    const poses: Pose[] = [
      { x: -10, y: 18, z: -2, offsetX: 0, offsetY: 0, perspective: 45, scale: 1.025 },
      { x: 40, y: -40, z: 30, offsetX: 25, offsetY: -12, perspective: 75, scale: 1.025 },
      { x: -35, y: 22, z: -15, offsetX: -60, offsetY: 60, perspective: 25, scale: 1 },
    ];
    for (const pose of poses)
      for (const [px, py] of [
        [0, 0],
        [0.8, -0.6],
        [-0.95, 0.9],
      ]) {
        const fit = fitScale(pose, 16 / 9, FIT_MARGIN);
        const q = project(pose, 16 / 9, px, py, fit);
        const back = unproject(pose, 16 / 9, q.x, q.y, fit);
        expect(back.x).toBeCloseTo(px, 9);
        expect(back.y).toBeCloseTo(py, 9);
      }
  });
});

describe("Aim mapping", () => {
  it("maps the flat, unzoomed frame straight onto the card", () => {
    const p = withZoom({});
    expect(toPreview(p, 5, 0, 0, view, true)).toEqual({ x: 72, y: 72 });
    expect(toPreview(p, 5, 1, 1, view, true)).toEqual({ x: 1528, y: 828 });
    expect(fromPreview(p, 5, 800, 450, view, true)).toEqual({ u: 0.5, v: 0.5 });
  });
  it("follows the 2D camera: the focus sits where the zoom centres it", () => {
    const p = withZoom({});
    // Before the zoom the camera is flat, so it matches the flat mapping.
    expect(toPreview(p, 0.5, 0.3, 0.4, view)).toEqual(
      toPreview(p, 0.5, 0.3, 0.4, view, true),
    );
    // Settled at 2×, the focus point (0.3, 0.4) is the centre of the card.
    const centre = toPreview(p, 6, 0.3, 0.4, view);
    expect(centre.x).toBeCloseTo(72 + 1456 / 2, 1);
    expect(centre.y).toBeCloseTo(72 + 756 / 2, 1);
    for (const [u, v] of [
      [0.3, 0.4],
      [0.1, 0.9],
      [0.55, 0.25],
    ]) {
      const pt = toPreview(p, 6, u, v, view);
      const back = fromPreview(p, 6, pt.x, pt.y, view);
      expect(back.u).toBeCloseTo(u, 9);
      expect(back.v).toBeCloseTo(v, 9);
    }
  });
  it("follows the 3D pose, including its fit to the frame", () => {
    const p = withZoom({
      mode: "3d",
      scale: 1.5,
      follow: false,
      tiltX: -15,
      tiltY: 30,
      tiltZ: 5,
    });
    const pt = toPreview(p, 6, 0.3, 0.4, view);
    const flat2d = withZoom({ scale: 1.5 });
    const plain = toPreview(flat2d, 6, 0.3, 0.4, view);
    expect(Math.hypot(pt.x - plain.x, pt.y - plain.y)).toBeGreaterThan(5);
    for (const [u, v] of [
      [0.3, 0.4],
      [0.05, 0.95],
      [0.9, 0.1],
    ]) {
      const q = toPreview(p, 6, u, v, view);
      const back = fromPreview(p, 6, q.x, q.y, view);
      expect(back.u).toBeCloseTo(u, 6);
      expect(back.v).toBeCloseTo(v, 6);
    }
  });
});

describe("Aiming a zoom", () => {
  const auto: Zoom = {
    id: "auto-3",
    start: 2,
    end: 9,
    x: 0.2,
    y: 0.2,
    scale: 2,
    focus: [
      { t: 2, x: 0.2, y: 0.2, click: 3 },
      { t: 5, x: 0.8, y: 0.7, click: 6 },
    ],
  };
  it("aims at the keyframe active at the playhead", () => {
    expect(focusAt(auto, 1)).toEqual({ x: 0.2, y: 0.2, key: 0 });
    expect(focusAt(auto, 4)).toEqual({ x: 0.2, y: 0.2, key: 0 });
    expect(focusAt(auto, 5.5)).toEqual({ x: 0.8, y: 0.7, key: 1 });
    expect(focusAt({ ...auto, focus: undefined }, 5.5)).toEqual({
      x: 0.2,
      y: 0.2,
      key: -1,
    });
  });
  it("moves that keyframe (the first also moves the zoom's own point), clamped to the frame", () => {
    expect(aimZoom(auto, 1, 0.5, 1.4)).toMatchObject({
      x: 0.2,
      y: 0.2,
      focus: [
        { t: 2, x: 0.2, y: 0.2, click: 3 },
        { t: 5, x: 0.5, y: 1, click: 6 },
      ],
    });
    expect(aimZoom(auto, 0, 0.4, 0.6)).toMatchObject({
      x: 0.4,
      y: 0.6,
      focus: [{ x: 0.4, y: 0.6 }, { x: 0.8, y: 0.7 }],
    });
    expect(aimZoom({ ...auto, focus: undefined }, -1, -1, 0.5)).toMatchObject({
      x: 0,
      y: 0.5,
    });
  });
  it("shows the area a magnification covers, kept inside the frame", () => {
    expect(zoomArea(0.5, 0.5, 2)).toEqual({
      left: 0.25,
      top: 0.25,
      width: 0.5,
      height: 0.5,
    });
    expect(zoomArea(0.05, 0.98, 4)).toEqual({
      left: 0,
      top: 0.75,
      width: 0.25,
      height: 0.25,
    });
  });
});
