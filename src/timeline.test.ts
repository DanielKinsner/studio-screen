import { describe, expect, it } from "vitest";
import {
  AUTO_HOLD,
  autoZooms,
  outputDuration,
  parseSrt,
  sourceTime,
  visibleSegments,
  zoomLead,
} from "./timeline";
import { cameraFeel, defaults, newProject, type Point } from "./types";
import { cameraAt } from "./camera";
import { migrateProject } from "./storage";
import { cleanSettings, styleKeys } from "./settings";
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
describe("Zoom while typing", () => {
  // A key every 0.25 s from `from` to exactly `to`.
  const keys = (from: number, to: number, x = 0.5, y = 0.5): Point[] =>
    Array.from({ length: Math.round((to - from) / 0.25) + 1 }, (_, i) => ({
      t: from + i * 0.25,
      x,
      y,
      typing: true,
    }));
  const take = (points: Point[]) => {
    const p = newProject(false);
    p.duration = 30;
    p.trimEnd = 30;
    p.points = [...points].sort((a, b) => a.t - b.t);
    return p;
  };
  it("keeps a click and the typing after it in one zoom that lasts through the burst", () => {
    const p = take([
      { t: 0, x: 0.5, y: 0.5 },
      { t: 3, x: 0.3, y: 0.4, click: true },
      ...keys(4, 7, 0.3, 0.4),
    ]);
    const zooms = autoZooms(p);
    expect(zooms).toHaveLength(1);
    const [z] = zooms;
    expect(z.id).toBe("auto-3");
    expect(z.start).toBeCloseTo(3 - zoomLead(0.6, 0.5), 6);
    expect(z.end).toBeCloseTo(7 + AUTO_HOLD, 6);
    expect(z.focus!.map((f) => [f.x, f.y])).toEqual([[0.3, 0.4]]);
    // It never zooms out and back in between the click and the end of typing.
    for (let t = 3; t <= 7 + AUTO_HOLD - 0.3; t += 0.1)
      expect(cameraAt(p, t).scale).toBeGreaterThan(1.5);
  });
  it("zooms to the pointer when typing starts with no recent click", () => {
    const p = take([
      { t: 0, x: 0.2, y: 0.2 },
      { t: 1, x: 0.4, y: 0.3, click: true },
      { t: 12, x: 0.7, y: 0.2 },
      ...keys(14, 16, 0.7, 0.2),
    ]);
    const zooms = autoZooms(p);
    const typed = zooms.find((z) => z.id === "auto-type-14")!;
    expect(typed).toBeDefined();
    expect([typed.x, typed.y]).toEqual([0.7, 0.2]);
    expect(typed.scale).toBe(p.settings.zoomStrength);
    expect(typed.end).toBeCloseTo(16 + AUTO_HOLD, 6);
    // The click 13 s earlier is its own, separate zoom.
    expect(zooms.map((z) => z.id)).toEqual(["auto-1", "auto-type-14"]);
  });
  it("aims at the field clicked up to 10 s before typing, even if the pointer moved away", () => {
    const p = take([
      { t: 0, x: 0.9, y: 0.9 },
      { t: 2, x: 0.25, y: 0.75, click: true },
      { t: 6, x: 0.9, y: 0.1 },
      ...keys(9, 11, 0.9, 0.1),
    ]);
    // Too far apart to merge (same rule as two clicks), so two zooms, both
    // on the clicked field.
    const zooms = autoZooms(p);
    expect(zooms.map((z) => z.id)).toEqual(["auto-2", "auto-type-9"]);
    expect([zooms[1].x, zooms[1].y]).toEqual([0.25, 0.75]);
    expect(zooms[1].end).toBeCloseTo(11 + AUTO_HOLD, 6);
  });
  it("ignores short or sparse typing, typing in a cut, after the trim and when turned off", () => {
    const sparse = take([
      { t: 2, x: 0.5, y: 0.5, typing: true },
      { t: 2.2, x: 0.5, y: 0.5, typing: true },
      { t: 8, x: 0.5, y: 0.5, typing: true },
    ]);
    expect(autoZooms(sparse)).toEqual([]);
    const burst = take(keys(5, 7, 0.6, 0.6));
    expect(autoZooms(burst)).toHaveLength(1);
    expect(autoZooms({ ...burst, cuts: [{ id: "g", start: 4, end: 8 }] })).toEqual([]);
    expect(
      autoZooms({ ...burst, cuts: [{ id: "r", start: 4, end: 8, ripple: true }] }),
    ).toEqual([]);
    expect(autoZooms({ ...burst, trimEnd: 4.5 })).toEqual([]);
    expect(
      autoZooms({ ...burst, settings: { ...burst.settings, zoomWhileTyping: false } }),
    ).toEqual([]);
  });
  it("can be dismissed like any automatic zoom, and Back to raw removes it", () => {
    const p = take(keys(5, 7, 0.6, 0.6));
    const [z] = autoZooms(p);
    expect(z.id).toBe("auto-type-5");
    expect(autoZooms({ ...p, dismissedZooms: [z.id] })).toEqual([]);
    expect(autoZooms({ ...p, settings: { ...p.settings, autoZoom: false } })).toEqual([]);
  });
  it("defaults on for older settings and is not part of a look", () => {
    expect(defaults.zoomWhileTyping).toBe(true);
    expect(styleKeys).not.toContain("zoomWhileTyping");
    const p = take(keys(5, 7));
    const { zoomWhileTyping: _, ...legacy } = p.settings;
    void _;
    expect(
      migrateProject({ ...p, settings: legacy as typeof p.settings }).settings
        .zoomWhileTyping,
    ).toBe(true);
  });
});
describe("Zoom lead", () => {
  it("adds half a second to every camera feel by default", () => {
    expect(defaults.zoomLead).toBe(0.5);
    const lead = (feel: keyof typeof cameraFeel) =>
      zoomLead(cameraFeel[feel].response, defaults.zoomLead);
    expect(lead("focused")).toBeCloseTo(0.842, 3);
    expect(lead("smooth")).toBeCloseTo(1.04, 3);
    expect(lead("gentle")).toBeCloseTo(1.355, 3);
    expect(zoomLead(0.6)).toBeCloseTo(0.54, 3);
  });
  it("starts automatic zooms and their focus changes that much earlier", () => {
    const p = newProject(false);
    p.duration = 30;
    p.trimEnd = 30;
    p.points = [
      { t: 5, x: 0.2, y: 0.2, click: true },
      { t: 6.5, x: 0.8, y: 0.8, click: true },
    ];
    const [z] = autoZooms(p);
    expect(z.start).toBeCloseTo(5 - 1.04, 6);
    expect(z.focus!.map((f) => +(f.click! - f.t).toFixed(6))).toEqual([
      1.04, 1.04,
    ]);
    p.settings = { ...p.settings, zoomLead: 0 };
    expect(autoZooms(p)[0].start).toBeCloseTo(5 - 0.54, 6);
  });
  it("loads settings saved before the zoom lead as +0.5 s and still plays", () => {
    const p = newProject(false);
    p.duration = 10;
    p.trimEnd = 10;
    p.points = [
      { t: 0, x: 0.5, y: 0.5 },
      { t: 4, x: 0.3, y: 0.3, click: true },
    ];
    const { zoomLead: _, ...legacy } = p.settings;
    void _;
    const migrated = migrateProject({
      ...p,
      settings: legacy as typeof p.settings,
    });
    expect(migrated.settings.zoomLead).toBe(0.5);
    expect(autoZooms(migrated)[0].start).toBeCloseTo(4 - 1.04, 6);
    expect(cameraAt(migrated, 4.5).scale).toBeGreaterThan(1.5);
  });
  it("is part of a look, clamped when imported", () => {
    expect(styleKeys).toContain("zoomLead");
    expect(cleanSettings({ zoomLead: 9 })).toEqual({ zoomLead: 1.5 });
    expect(cleanSettings({ zoomLead: -1 })).toEqual({ zoomLead: 0 });
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
