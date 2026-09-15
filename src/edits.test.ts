import { describe, expect, it } from "vitest";
import {
  FRAME,
  closeGap,
  deletePiece,
  dragEdge,
  editPoints,
  pieces,
  restore,
  snapValue,
  sourceFromTimeline,
  splitAt,
  timelineDuration,
  timelineTime,
} from "./edits";
import { autoZooms, outputDuration, sourceTime } from "./timeline";
import { newProject, type Project } from "./types";
import { migrateProject } from "./storage";
import { cameraAt } from "./camera";

function project(duration = 20): Project {
  const p = newProject(false);
  p.duration = duration;
  p.trimEnd = duration;
  p.settings.autoZoom = false;
  return p;
}
const ranges = (p: Project) => pieces(p).map((x) => [x.start, x.end]);

describe("Pieces and splits", () => {
  it("is one piece between the trim ends until split", () => {
    const p = project();
    p.trimStart = 1;
    p.trimEnd = 19;
    expect(ranges(p)).toEqual([[1, 19]]);
    const split = splitAt(splitAt(p, 5), 12);
    expect(split.splits).toEqual([5, 12]);
    expect(ranges(split)).toEqual([
      [1, 5],
      [5, 12],
      [12, 19],
    ]);
  });
  it("ignores a split within a frame of an existing edit point or outside the footage", () => {
    const p = splitAt(project(), 5);
    expect(splitAt(p, 5 + FRAME / 2)).toBe(p);
    expect(splitAt(p, FRAME / 2)).toBe(p);
    expect(splitAt(p, 20)).toBe(p);
    expect(splitAt(p, 25)).toBe(p);
    const cut = { ...p, cuts: [{ id: "c", start: 8, end: 10 }] };
    expect(splitAt(cut, 9)).toBe(cut);
    expect(splitAt(cut, 8 + FRAME / 3)).toBe(cut);
  });
  it("lists kept ranges around gaps and splits, ignoring splits outside the trim", () => {
    const p = project();
    p.splits = [3, 9, 15, 19.5];
    p.trimEnd = 18;
    p.cuts = [{ id: "g", start: 6, end: 11 }];
    expect(ranges(p)).toEqual([
      [0, 3],
      [3, 6],
      [11, 15],
      [15, 18],
    ]);
    expect(editPoints(p)).toEqual([0, 3, 6, 9, 11, 15, 18]);
  });
});

describe("Delete, ripple, close and restore", () => {
  const threePieces = () => splitAt(splitAt(project(), 5), 10);

  it("leaves a gap that playback skips while everything else stays put", () => {
    const p = threePieces();
    p.zooms = [{ id: "z", start: 6, end: 9, x: 0.5, y: 0.5, scale: 2 }];
    const middle = pieces(p)[1];
    const gap = deletePiece(p, middle, { ripple: false });
    expect(gap.cuts).toHaveLength(1);
    expect(gap.cuts[0]).toMatchObject({ start: 5, end: 10 });
    expect(gap.cuts[0].ripple).toBeFalsy();
    expect(outputDuration(gap)).toBe(15);
    expect(gap.zooms).toEqual(p.zooms);
    // Gaps keep their width on the timeline.
    expect(timelineDuration(gap)).toBe(20);
    expect(timelineTime(gap, 12)).toBe(12);
  });
  it("ripple delete removes the footage, the items inside it, and slides the rest left", () => {
    const p = threePieces();
    p.zooms = [
      { id: "inside", start: 6, end: 9, x: 0.5, y: 0.5, scale: 2 },
      { id: "straddle", start: 3, end: 7, x: 0.5, y: 0.5, scale: 2 },
      {
        id: "spanning",
        start: 2,
        end: 14,
        x: 0.5,
        y: 0.5,
        scale: 2,
        focus: [
          { t: 2, x: 0.2, y: 0.2 },
          { t: 7, x: 0.5, y: 0.5 },
          { t: 12, x: 0.8, y: 0.8 },
        ],
      },
    ];
    p.speeds = [
      { id: "fast", start: 12, end: 16, rate: 2 },
      { id: "cut-into", start: 9, end: 13, rate: 2 },
    ];
    p.captions = [{ id: "cap", start: 5, end: 10, text: "gone" }];
    p.annotations = [
      {
        id: "note",
        type: "text",
        start: 4,
        end: 6,
        text: "hi",
        x: 0,
        y: 0,
        width: 0.1,
        height: 0.1,
      },
    ];
    p.hiddenCursor = [{ id: "h", start: 5.5, end: 8 }];
    const r = deletePiece(p, pieces(p)[1], { ripple: true });
    expect(r.cuts[0]).toMatchObject({ start: 5, end: 10, ripple: true });
    expect(r.zooms.map((z) => [z.id, z.start, z.end])).toEqual([
      ["straddle", 3, 5],
      ["spanning", 2, 14],
    ]);
    expect(r.zooms[1].focus!.map((f) => f.t)).toEqual([2, 12]);
    expect(r.speeds.map((s) => [s.id, s.start, s.end])).toEqual([
      ["fast", 12, 16],
      ["cut-into", 10, 13],
    ]);
    expect(r.captions).toEqual([]);
    expect(r.annotations.map((a) => [a.start, a.end])).toEqual([[4, 5]]);
    expect(r.hiddenCursor).toEqual([]);
    // Stored in source time, drawn shifted left by the removed 5 s.
    expect(timelineTime(r, 12)).toBe(7);
    expect(timelineTime(r, 16)).toBe(11);
    expect(timelineDuration(r)).toBe(15);
    // 5 s before the cut, then 10–12 and 12–16 at 2× (3 s), then 16–20.
    expect(outputDuration(r)).toBe(5 + 1 + 0.5 + 1.5 + 4);
  });
  it("closes a gap as a ripple and restores footage", () => {
    const p = threePieces();
    p.captions = [{ id: "cap", start: 6, end: 8, text: "in the gap" }];
    const gap = deletePiece(p, pieces(p)[1], { ripple: false });
    const id = gap.cuts[0].id;
    const closed = closeGap(gap, id);
    expect(closed.cuts[0].ripple).toBe(true);
    expect(closed.captions).toEqual([]);
    expect(timelineDuration(closed)).toBe(15);
    expect(closeGap(closed, id)).toBe(closed);
    const restored = restore(closed, id);
    expect(restored.cuts).toEqual([]);
    expect(ranges(restored)).toEqual([
      [0, 5],
      [5, 10],
      [10, 20],
    ]);
    // Items removed by the ripple only come back through undo.
    expect(restored.captions).toEqual([]);
  });
  it("never leaves less than a quarter second of output", () => {
    const p = splitAt(project(1), 0.8);
    expect(deletePiece(p, pieces(p)[0], { ripple: true })).toBe(p);
    expect(deletePiece(p, pieces(p)[1], { ripple: true })).not.toBe(p);
    const tiny = splitAt(project(1), 0.1);
    const onlyTail = deletePiece(tiny, pieces(tiny)[1], { ripple: false });
    expect(onlyTail).toBe(tiny);
  });
  it("renders the same video whether a cut is a gap or a ripple", () => {
    const p = threePieces();
    p.speeds = [{ id: "s", start: 12, end: 16, rate: 2 }];
    const gap = deletePiece(p, pieces(p)[1], { ripple: false, id: "c" });
    const ripple = deletePiece(p, pieces(p)[1], { ripple: true, id: "c" });
    expect(outputDuration(ripple)).toBe(outputDuration(gap));
    for (let u = 0; u < outputDuration(gap); u += 0.37)
      expect(sourceTime(ripple, u)).toBe(sourceTime(gap, u));
  });
});

describe("Collapsed timeline mapping", () => {
  it("maps both ways around ripple cuts, overlapping or not", () => {
    const p = project(30);
    p.cuts = [
      { id: "a", start: 4, end: 6, ripple: true },
      { id: "b", start: 10, end: 14, ripple: true },
      { id: "c", start: 12, end: 16, ripple: true },
      { id: "gap", start: 20, end: 22 },
    ];
    expect(timelineDuration(p)).toBe(30 - 2 - 6);
    expect(timelineTime(p, 5)).toBe(4);
    expect(timelineTime(p, 8)).toBe(6);
    expect(timelineTime(p, 13)).toBe(8);
    expect(timelineTime(p, 21)).toBe(13);
    for (const t of [0, 3.9, 6, 9.5, 16, 21, 29])
      expect(sourceFromTimeline(p, timelineTime(p, t))).toBeCloseTo(t, 9);
    // A collapse point opens onto the footage after the removed range.
    expect(sourceFromTimeline(p, 4)).toBe(6);
  });
});

describe("Edge drags", () => {
  it("drags a split edge inward into a gap, Shift makes it a ripple", () => {
    const p = splitAt(project(), 10);
    const gap = dragEdge(p, { kind: "split", at: 10, side: "left" }, 8, false, "g");
    expect(gap.cuts).toEqual([{ id: "g", start: 8, end: 10 }]);
    const ripple = dragEdge(p, { kind: "split", at: 10, side: "right" }, 13, true, "r");
    expect(ripple.cuts).toEqual([{ id: "r", start: 10, end: 13, ripple: true }]);
    expect(timelineDuration(ripple)).toBe(17);
    // Dragging outward from a split has nothing to reclaim.
    expect(dragEdge(p, { kind: "split", at: 10, side: "left" }, 12, false)).toBe(p);
  });
  it("grows a gap inward and reclaims footage outward, but only from that gap", () => {
    const p = project();
    p.cuts = [{ id: "g", start: 8, end: 12 }];
    const grown = dragEdge(p, { kind: "cut-start", id: "g" }, 6, false);
    expect(grown.cuts[0]).toMatchObject({ start: 6, end: 12 });
    const reclaimed = dragEdge(p, { kind: "cut-end", id: "g" }, 9, false);
    expect(reclaimed.cuts[0]).toMatchObject({ start: 8, end: 9 });
    const clamped = dragEdge(p, { kind: "cut-start", id: "g" }, 30, false);
    expect(clamped.cuts[0].end - clamped.cuts[0].start).toBeCloseTo(FRAME, 9);
  });
  it("ripple-trims next to a gap without merging them", () => {
    const p = project();
    p.cuts = [{ id: "g", start: 8, end: 12 }];
    p.captions = [{ id: "c", start: 6.5, end: 7.5, text: "x" }];
    const r = dragEdge(p, { kind: "cut-start", id: "g" }, 6, true, "r");
    expect(r.cuts).toEqual([
      { id: "g", start: 8, end: 12 },
      { id: "r", start: 6, end: 8, ripple: true },
    ]);
    expect(r.captions).toEqual([]);
  });
  it("moves the trim ends from the outer edges", () => {
    const p = project();
    expect(dragEdge(p, { kind: "trim-start" }, 2, false).trimStart).toBe(2);
    expect(dragEdge(p, { kind: "trim-end" }, 25, false).trimEnd).toBe(20);
    expect(dragEdge(p, { kind: "trim-end" }, 0.1, false)).toBe(p);
  });
});

describe("Snapping", () => {
  it("lands exactly on the nearest target within reach, and nowhere else", () => {
    expect(snapValue(4.93, [2, 5, 9], 0.1)).toBe(5);
    expect(snapValue(4.85, [2, 5, 9], 0.1)).toBe(4.85);
    expect(snapValue(5.04, [5, 5.1], 0.1)).toBe(5);
    expect(snapValue(5.07, [5, 5.1], 0.1)).toBe(5.1);
    expect(snapValue(3, [], 1)).toBe(3);
  });
});

describe("Cuts and automatic zooms", () => {
  it("never makes automatic zooms from clicks inside any cut, and restoring brings them back", () => {
    const p = project(30);
    p.settings.autoZoom = true;
    p.points = [
      { t: 3, x: 0.2, y: 0.2, click: true },
      { t: 15, x: 0.8, y: 0.8, click: true },
    ];
    expect(autoZooms(p).map((z) => z.id)).toEqual(["auto-3", "auto-15"]);
    const gap = { ...p, cuts: [{ id: "g", start: 14, end: 16 }] };
    expect(autoZooms(gap).map((z) => z.id)).toEqual(["auto-3"]);
    const ripple = closeGap(gap, "g");
    expect(autoZooms(ripple).map((z) => z.id)).toEqual(["auto-3"]);
    expect(autoZooms(restore(ripple, "g")).map((z) => z.id)).toEqual([
      "auto-3",
      "auto-15",
    ]);
  });
});

describe("Older projects", () => {
  it("load without splits or ripple flags and still play", () => {
    const p = project(12);
    p.cuts = [{ id: "old", start: 2, end: 4 }];
    p.zooms = [{ id: "z", start: 5, end: 8, x: 0.3, y: 0.3, scale: 2 }];
    const { splits: _, ...legacy } = p;
    void _;
    const migrated = migrateProject(legacy as Project);
    expect(migrated.splits).toEqual([]);
    expect(migrated.cuts[0].ripple).toBeFalsy();
    expect(ranges(migrated)).toEqual([
      [0, 2],
      [4, 12],
    ]);
    expect(timelineDuration(migrated)).toBe(12);
    expect(outputDuration(migrated)).toBe(10);
    expect(cameraAt(migrated, 6.5).scale).toBeGreaterThan(1.5);
  });
});
