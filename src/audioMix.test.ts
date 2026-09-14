import { describe, expect, it } from "vitest";
import { fadePoints, sourcePieces } from "./audioMix";
import { fadeAt } from "./sound";
import { newProject } from "./types";

describe("Export audio plan", () => {
  it("maps an output window onto trimmed, cut and sped-up source audio", () => {
    const p = newProject(false);
    p.duration = 12;
    p.trimStart = 1;
    p.trimEnd = 12;
    p.cuts = [{ id: "cut", start: 3, end: 5 }];
    p.speeds = [{ id: "fast", start: 6, end: 10, rate: 2 }];
    // Output: [0,2) = src 1-3, [2,3) = src 5-6, [3,5) = src 6-10 at 2x, [5,7) = src 10-12.
    expect(sourcePieces(p, 0, 7)).toEqual([
      { at: 0, length: 2, from: 1, to: 3, rate: 1 },
      { at: 2, length: 1, from: 5, to: 6, rate: 1 },
      { at: 3, length: 2, from: 6, to: 10, rate: 2 },
      { at: 5, length: 2, from: 10, to: 12, rate: 1 },
    ]);
    // A chunk boundary inside the sped-up section splits it proportionally.
    expect(sourcePieces(p, 4, 6)).toEqual([
      { at: 0, length: 1, from: 8, to: 10, rate: 2 },
      { at: 1, length: 1, from: 10, to: 11, rate: 1 },
    ]);
  });
  it("describes fades exactly as straight-line gain points", () => {
    const total = 10,
      fade = 1.5;
    for (const [u0, u1] of [
      [0, 10],
      [0.5, 3],
      [8, 10],
    ]) {
      const points = fadePoints(total, fade, u0, u1);
      expect(points[0][0]).toBe(0);
      expect(points.at(-1)![0]).toBeCloseTo(u1 - u0, 9);
      for (const [at, gain] of points)
        expect(gain).toBeCloseTo(fadeAt(u0 + at, total, fade), 9);
    }
    // Fades longer than half the edit meet in the middle.
    expect(fadePoints(2, 3, 0, 2).map(([at]) => at)).toContain(1);
    expect(fadePoints(10, 0, 0, 4)).toEqual([
      [0, 1],
      [4, 1],
    ]);
  });
});
