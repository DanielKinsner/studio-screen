import { describe, it, expect } from "vitest";
import { newProject } from "./types";
import {
  outputDuration,
  sourceTime,
  outputTimeAt,
  typingSections,
  captionsSrt,
  parseSrt,
} from "./timeline";
import { poseAt, cursorOpacity, smoothPointer } from "./motion";
import { fadeAt, clickEvents } from "./sound";
describe("Edited timing", () => {
  it("maps variable speeds and overlapping cuts in both directions", () => {
    const p = newProject();
    p.trimStart = 2;
    p.trimEnd = 14;
    p.cuts = [
      { id: "a", start: 5, end: 7 },
      { id: "b", start: 6, end: 8 },
    ];
    p.speeds = [{ id: "s", start: 3, end: 10, rate: 2 }];
    expect(outputDuration(p)).toBe(7);
    expect(sourceTime(p, 2)).toBe(8);
    expect(sourceTime(p, 3)).toBe(10);
    expect(outputTimeAt(p, 6)).toBe(2);
    for (let t = 0; t < 7; t += 0.1)
      expect(outputTimeAt(p, sourceTime(p, t))).toBeCloseTo(t, 7);
  });
  it("exports caption timing in edited time, excluding removed footage", () => {
    const p = newProject();
    p.trimEnd = 8;
    p.captions = [{ id: "c", start: 0, end: 8, text: "Read this" }];
    p.cuts = [{ id: "x", start: 2, end: 4 }];
    p.speeds = [{ id: "s", start: 4, end: 8, rate: 2 }];
    expect(parseSrt(captionsSrt(p)).map((c) => [c.start, c.end])).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });
  it("creates typing speedups only from sustained activity within trim", () => {
    const p = newProject();
    p.trimStart = 1;
    p.trimEnd = 5;
    p.points = [0, 0.2, 0.4, 2, 2.4, 2.8, 3.1, 9].map((t) => ({
      t,
      x: 0.5,
      y: 0.5,
      typing: true,
    }));
    expect(typingSections(p).map((s) => [s.start, s.end, s.rate])).toEqual([
      [1.9, 3.5, 2],
    ]);
  });
  it("keeps click sound timestamps aligned with cuts and speed", () => {
    const p = newProject();
    p.points = [
      { t: 2, x: 0.5, y: 0.5, click: true },
      { t: 6, x: 0.5, y: 0.5, click: true },
    ];
    p.demo = false;
    p.trimEnd = 8;
    p.cuts = [{ id: "cut", start: 1, end: 3 }];
    p.settings.speed = 2;
    expect(clickEvents(p)).toEqual([2]);
  });
});
describe("Motion and audio", () => {
  it("returns to an untilted screen at both ends and supports manual tilt without metadata", () => {
    const p = newProject();
    p.demo = false;
    p.settings.autoZoom = false;
    p.zooms = [
      {
        id: "3d",
        start: 1,
        end: 5,
        x: 0.5,
        y: 0.5,
        scale: 1.5,
        mode: "3d",
        follow: false,
        tiltY: 30,
        tiltX: -15,
        tiltZ: 5,
      },
    ];
    expect(poseAt(p, 1).y).toBe(0);
    expect(poseAt(p, 5).y).toBe(0);
    expect(poseAt(p, 3)).toMatchObject({ x: -15, y: 30, z: 5 });
  });
  it("smooths pointer movement and applies idle and explicit hiding", () => {
    const p = newProject();
    p.demo = false;
    p.settings.cursorSmoothing = 0.1;
    p.settings.cursorIdle = true;
    p.points = [
      { t: 0, x: 0, y: 0 },
      { t: 1, x: 1, y: 1 },
      { t: 3, x: 1, y: 1 },
    ];
    expect(smoothPointer(p, 1).x).toBeCloseTo(0.93);
    expect(cursorOpacity(p, 3)).toBe(0);
    p.hiddenCursor = [{ id: "hidden", start: 0.2, end: 0.6 }];
    expect(cursorOpacity(p, 0.4)).toBe(0);
  });
  it("fades at edited endpoints, even for shorter videos", () => {
    expect(fadeAt(0, 10, 1)).toBe(0);
    expect(fadeAt(0.5, 10, 1)).toBe(0.5);
    expect(fadeAt(9.5, 10, 1)).toBe(0.5);
    expect(fadeAt(0.5, 1, 2)).toBe(0.25);
    expect(fadeAt(0, 10, 0)).toBe(1);
  });
});
