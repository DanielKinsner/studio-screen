import { describe, expect, it } from "vitest";
import { FIT_MARGIN, fitScale, project, type CardRect } from "./perspective";
import type { Pose } from "./camera";

const flat: Pose = {
  x: 0,
  y: 0,
  z: 0,
  offsetX: 0,
  offsetY: 0,
  perspective: 45,
  scale: 1,
};
const full: CardRect = { left: -1, top: 1, right: 1, bottom: -1 };
const aspect = 16 / 9;
const corners = (card: CardRect) =>
  [
    [card.left, card.top],
    [card.right, card.top],
    [card.left, card.bottom],
    [card.right, card.bottom],
  ] as const;

describe("3D fit to frame", () => {
  it("projects a flat pose onto itself", () => {
    const q = project(flat, aspect, 0.5, -0.25);
    expect(q.x).toBeCloseTo(0.5, 9);
    expect(q.y).toBeCloseTo(-0.25, 9);
  });
  it("leaves a flat card alone at any padding", () => {
    expect(fitScale(flat, aspect, FIT_MARGIN, full)).toBe(1);
    expect(
      fitScale(flat, aspect, FIT_MARGIN, {
        left: -0.8,
        top: 0.8,
        right: 0.8,
        bottom: -0.8,
      }),
    ).toBe(1);
  });
  it("shrinks an extreme tilt at zero padding until every corner is inside", () => {
    const poses: Pose[] = [
      { ...flat, x: 40, y: 40, z: 30, perspective: 75, scale: 1.025 },
      { ...flat, x: -40, y: -40, z: -30, perspective: 25, scale: 1.025 },
      { ...flat, x: -10, y: 18, z: -2, offsetX: 60, offsetY: -60, scale: 1.025 },
    ];
    for (const pose of poses) {
      const fit = fitScale(pose, aspect, FIT_MARGIN, full);
      expect(fit).toBeLessThan(1);
      expect(fit).toBeGreaterThan(0.2);
      for (const [px, py] of corners(full)) {
        const q = project(pose, aspect, px, py, fit);
        expect(Math.abs(q.x)).toBeLessThanOrEqual(1 - FIT_MARGIN + 1e-9);
        expect(Math.abs(q.y)).toBeLessThanOrEqual(1 - FIT_MARGIN + 1e-9);
      }
    }
  });
  it("fits continuously as a flat card starts to tilt", () => {
    let previous = 1;
    for (let tilt = 0; tilt <= 40; tilt += 0.25) {
      const fit = fitScale(
        { ...flat, x: -tilt / 2, y: tilt, scale: 1 + (0.025 * tilt) / 40 },
        aspect,
        FIT_MARGIN,
        full,
      );
      expect(Math.abs(fit - previous)).toBeLessThan(0.01);
      previous = fit;
    }
  });
  it("does not shrink a padded card whose tilt already fits", () => {
    const padded = { left: -0.7, top: 0.7, right: 0.7, bottom: -0.7 };
    const pose = { ...flat, x: -10, y: 18, z: -2, scale: 1.025 };
    expect(fitScale(pose, aspect, FIT_MARGIN, padded)).toBe(1);
    // Default padding (8%) spans ±0.84: the default tilt just touches the
    // margin, so it shrinks by about 1%.
    const standard = { left: -0.84, top: 0.84, right: 0.84, bottom: -0.84 };
    expect(fitScale(pose, aspect, FIT_MARGIN, standard)).toBeGreaterThan(0.98);
  });
});
