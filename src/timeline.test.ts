import { describe, expect, it } from "vitest";
import {
  autoZooms,
  outputDuration,
  parseSrt,
  sourceTime,
  visibleSegments,
  zoomAt,
} from "./timeline";
import { newProject } from "./types";
describe("Non-destructive timeline", () => {
  it("merges overlapping cuts and respects trim boundaries", () => {
    const p = newProject();
    p.trimStart = 2;
    p.trimEnd = 20;
    p.cuts = [
      { id: "a", start: 0, end: 4 },
      { id: "b", start: 8, end: 12 },
      { id: "c", start: 10, end: 14 },
      { id: "d", start: 19, end: 25 },
    ];
    expect(visibleSegments(p)).toEqual([
      { start: 4, end: 8 },
      { start: 14, end: 19 },
    ]);
    expect(outputDuration(p)).toBe(9);
    p.settings.speed = 2;
    expect(outputDuration(p)).toBe(4.5);
    expect(sourceTime(p, 2)).toBe(14);
    expect(sourceTime(p, 4)).toBe(18);
  });
  it("does not create negative or duplicate output when all footage is cut", () => {
    const p = newProject();
    p.cuts = [{ id: "a", start: 0, end: 24 }];
    expect(visibleSegments(p)).toEqual([]);
    expect(outputDuration(p)).toBe(0);
  });
  it("uses eased transitions at the beginning and end of a zoom", () => {
    const z = [{ id: "z", start: 1, end: 5, x: 0.2, y: 0.7, scale: 2 }];
    expect(zoomAt(z, 0).scale).toBe(1);
    expect(zoomAt(z, 1).scale).toBe(1);
    expect(zoomAt(z, 3)).toEqual({ scale: 2, x: 0.2, y: 0.7 });
    expect(zoomAt(z, 5).scale).toBe(1);
    expect(zoomAt(z, 1.3).scale).toBeGreaterThan(1);
    expect(zoomAt(z, 1.3).scale).toBeLessThan(2);
  });
  it("generates zooms only from click evidence and keeps manual focus priority", () => {
    const p = newProject(false);
    p.duration = 20;
    p.points = [
      { t: 1, x: 0.2, y: 0.3 },
      { t: 3, x: 0.7, y: 0.4, click: true },
      { t: 3.2, x: 0.7, y: 0.4, click: true },
      { t: 12, x: 0.2, y: 0.3, click: true },
    ];
    p.zooms = [{ id: "manual", start: 11, end: 15, x: 0.3, y: 0.4, scale: 2 }];
    expect(autoZooms(p)).toHaveLength(2);
    expect(autoZooms(p)[0].id).toBe("auto-3");
    p.settings.autoZoom = false;
    expect(autoZooms(p)).toEqual(p.zooms);
  });
});
describe("Caption import", () => {
  it("reads multiline SRT with CRLF and strips formatting", () => {
    const result = parseSrt(
      "1\r\n00:00:01,250 --> 00:00:03,500\r\nHello <b>there</b>\r\nSecond line\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nNext",
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      start: 1.25,
      end: 3.5,
      text: "Hello there\nSecond line",
    });
  });
  it("ignores malformed times and reversed ranges", () => {
    expect(
      parseSrt(
        "1\nnope --> invalid\nText\n\n2\n00:00:05,000 --> 00:00:02,000\nText",
      ),
    ).toEqual([]);
  });
});
