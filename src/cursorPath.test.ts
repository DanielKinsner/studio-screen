import { describe, expect, it } from "vitest";
import { newProject, type Point } from "./types";
import {
  clickAt,
  cursorShapeAt,
  cursorOpacity,
  pointerAt,
  shortcutAt,
  smoothPointer,
} from "./cursorPath";

// Deterministic pseudo-random noise so the test never flakes.
function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647 - 0.5;
  };
}
function recorded(points: Point[], smoothing = 0.08) {
  const p = newProject(false);
  p.points = points;
  p.duration = points.at(-1)?.t || 0;
  p.trimEnd = p.duration;
  p.settings.cursorSmoothing = smoothing;
  return p;
}
function roughness(values: number[]) {
  let sum = 0;
  for (let i = 1; i < values.length - 1; i++)
    sum += Math.abs(values[i + 1] - 2 * values[i] + values[i - 1]);
  return sum / (values.length - 2);
}

describe("Cursor path", () => {
  it("removes most of the hand jitter from a recorded path", () => {
    const rand = noise(7);
    const points: Point[] = [];
    for (let i = 0; i <= 300; i++) {
      const t = i / 60;
      points.push({
        t,
        x: 0.2 + 0.1 * t + rand() * 0.008,
        y: 0.5 + rand() * 0.008,
      });
    }
    const p = recorded(points);
    const times = points.filter((pt) => pt.t >= 0.5 && pt.t <= 4.5);
    const raw = times.map((pt) => pointerAt(p, pt.t).x);
    const smooth = times.map((pt) => smoothPointer(p, pt.t).x);
    expect(roughness(smooth)).toBeLessThan(roughness(raw) * 0.4);
  });
  it("lands exactly on every click", () => {
    const points: Point[] = [];
    for (let i = 0; i <= 240; i++) {
      const t = i / 60;
      points.push({
        t,
        x: 0.5 + 0.3 * Math.sin(t * 3),
        y: 0.5 + 0.3 * Math.cos(t * 2),
        click: i % 50 === 25,
      });
    }
    const p = recorded(points, 0.2);
    for (const click of points.filter((pt) => pt.click)) {
      const at = smoothPointer(p, click.t);
      expect(Math.abs(at.x - click.x)).toBeLessThan(1e-6);
      expect(Math.abs(at.y - click.y)).toBeLessThan(1e-6);
    }
  });
  it("gives the same answer whatever order times are asked in", () => {
    const rand = noise(3);
    const points: Point[] = [];
    for (let i = 0; i <= 600; i++)
      points.push({ t: i / 60, x: 0.5 + rand() * 0.4, y: 0.5 + rand() * 0.4 });
    const p = recorded(points, 0.15);
    const times = Array.from({ length: 500 }, (_, i) => (i * 10) / 500);
    const ascending = times.map((t) => smoothPointer(p, t));
    const shuffled = [...times.keys()].sort(() => rand());
    const p2 = recorded(
      points.map((pt) => ({ ...pt })),
      0.15,
    );
    for (const i of shuffled)
      expect(smoothPointer(p2, times[i])).toEqual(ascending[i]);
  });
  it("returns raw positions when smoothing is off", () => {
    const p = recorded(
      [
        { t: 0, x: 0, y: 0 },
        { t: 1, x: 1, y: 0.5 },
      ],
      0,
    );
    expect(smoothPointer(p, 0.25)).toEqual(pointerAt(p, 0.25));
  });
  it("lags behind a fast move and then settles on the target", () => {
    const p = recorded(
      [
        { t: 0, x: 0, y: 0 },
        { t: 1, x: 1, y: 1 },
        { t: 3, x: 1, y: 1 },
      ],
      0.1,
    );
    const moving = smoothPointer(p, 1).x;
    expect(moving).toBeGreaterThan(0.6);
    expect(moving).toBeLessThan(1);
    expect(smoothPointer(p, 3).x).toBeCloseTo(1, 2);
  });
});

describe("Cursor lookups", () => {
  it("hides after idle time and inside explicit hidden ranges", () => {
    const p = recorded([
      { t: 0, x: 0, y: 0 },
      { t: 1, x: 1, y: 1 },
      { t: 3, x: 1, y: 1 },
    ]);
    p.settings.cursorIdle = true;
    expect(cursorOpacity(p, 1.5)).toBe(1);
    expect(cursorOpacity(p, 3)).toBe(0);
    p.hiddenCursor = [{ id: "hidden", start: 0.2, end: 0.6 }];
    expect(cursorOpacity(p, 0.4)).toBe(0);
    p.settings.cursorIdle = false;
    expect(cursorOpacity(p, 3)).toBe(1);
  });
  it("finds the most recent click and shortcut", () => {
    const p = recorded([
      { t: 0, x: 0, y: 0 },
      { t: 1, x: 0.2, y: 0.2, click: true },
      { t: 1.3, x: 0.2, y: 0.2, click: true, shortcut: "Ctrl + K" },
      { t: 2, x: 0.3, y: 0.3, shortcut: "Ctrl + S" },
      { t: 6, x: 0.3, y: 0.3 },
    ]);
    expect(clickAt(p, 0.9)).toBeUndefined();
    expect(clickAt(p, 1.2)).toBe(1);
    expect(clickAt(p, 1.4)).toBe(1.3);
    expect(clickAt(p, 1.9)).toBeUndefined();
    expect(shortcutAt(p, 1.5)?.shortcut).toBe("Ctrl + K");
    expect(shortcutAt(p, 2.5)?.shortcut).toBe("Ctrl + S");
    expect(shortcutAt(p, 4)).toBeUndefined();
  });
  it("uses the sample project's scripted clicks and shortcuts", () => {
    const p = newProject();
    expect(clickAt(p, 5.2)).toBe(5);
    expect(shortcutAt(p, 6.5)?.shortcut).toBe("Ctrl + K");
  });
  it("follows the recorded cursor shape", () => {
    const p = recorded([
      { t: 0, x: 0.1, y: 0.1 },
      { t: 1, x: 0.2, y: 0.2, cursor: "text" },
      { t: 2, x: 0.3, y: 0.3, cursor: "pointer" },
      { t: 3, x: 0.3, y: 0.3 },
    ]);
    expect(cursorShapeAt(p, 0.5)).toBe("arrow");
    expect(cursorShapeAt(p, 1.5)).toBe("text");
    expect(cursorShapeAt(p, 2.5)).toBe("pointer");
  });
});
