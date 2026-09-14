import { describe, expect, it } from "vitest";
import {
  autoZooms,
  outputDuration,
  parseSrt,
  sourceTime,
  visibleSegments,
} from "./timeline";
import { newProject, type Point } from "./types";
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
  it("generates zooms only from click evidence and keeps manual focus priority", () => {
    const p = newProject(false);
    p.duration = 20;
    p.trimEnd = 20;
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
describe("Automatic zooms", () => {
  const clicks = (list: [number, number, number][]) => {
    const p = newProject(false);
    p.duration = 30;
    p.trimEnd = 30;
    p.points = list.map(([t, x, y]): Point => ({ t, x, y, click: true }));
    return p;
  };
  it("keeps nearby clicks in one zoom that glides between them", () => {
    const zooms = autoZooms(
      clicks([
        [3, 0.2, 0.2],
        [4.5, 0.8, 0.7],
      ]),
    );
    expect(zooms).toHaveLength(1);
    expect(zooms[0].focus?.map((f) => [f.x, f.y])).toEqual([
      [0.2, 0.2],
      [0.8, 0.7],
    ]);
    expect(zooms[0].start).toBeLessThan(3);
    expect(zooms[0].end).toBeGreaterThan(4.5);
  });
  it("starts a separate zoom for clicks far apart in time", () => {
    const zooms = autoZooms(
      clicks([
        [3, 0.2, 0.2],
        [13, 0.8, 0.7],
      ]),
    );
    expect(zooms.map((z) => z.id)).toEqual(["auto-3", "auto-13"]);
  });
  it("treats rapid clicks on one spot as a single focus", () => {
    const zooms = autoZooms(
      clicks(
        Array.from({ length: 10 }, (_, i): [number, number, number] => [
          2 + i * 0.3,
          0.5,
          0.5,
        ]),
      ),
    );
    expect(zooms).toHaveLength(1);
    expect(zooms[0].focus).toHaveLength(1);
  });
  it("paces focus changes when rapid clicks jump around", () => {
    const zooms = autoZooms(
      clicks(
        Array.from({ length: 10 }, (_, i): [number, number, number] => [
          2 + i * 0.3,
          i % 2 ? 0.9 : 0.1,
          i % 2 ? 0.9 : 0.1,
        ]),
      ),
    );
    expect(zooms).toHaveLength(1);
    const focus = zooms[0].focus!;
    expect(focus.length).toBeGreaterThan(1);
    for (let i = 1; i < focus.length; i++)
      expect(focus[i].t - focus[i - 1].t).toBeGreaterThanOrEqual(0.4 - 1e-9);
  });
  it("skips a click that is already in the middle of the zoomed view", () => {
    const zooms = autoZooms(
      clicks([
        [3, 0.5, 0.5],
        [4, 0.55, 0.52],
      ]),
    );
    expect(zooms[0].focus).toHaveLength(1);
  });
  it("honours dismissed automatic zooms", () => {
    const p = clicks([
      [3, 0.2, 0.2],
      [13, 0.8, 0.7],
    ]);
    p.dismissedZooms = ["auto-3"];
    expect(autoZooms(p).map((z) => z.id)).toEqual(["auto-13"]);
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
