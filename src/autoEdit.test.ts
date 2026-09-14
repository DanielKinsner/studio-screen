import { describe, expect, it } from "vitest";
import { autoEdit, backToRaw, idleSections } from "./autoEdit";
import { autoZooms } from "./timeline";
import { newProject, type Point, type Project } from "./types";

function recording(
  duration: number,
  points: Point[],
  activity: [number, number][] = [],
) {
  const p = newProject(false);
  p.capture = "native";
  p.duration = duration;
  p.trimEnd = duration;
  p.points = points;
  p.activity = activity;
  return p;
}
const move = (t: number, x = 0.5, y = 0.5): Point => ({ t, x, y });

describe("Auto-edit on stop", () => {
  it("trims dead air before the first action and the reach for the bar at the end", () => {
    const points: Point[] = [
      move(0),
      move(2.8),
      { t: 3, x: 0.4, y: 0.4, click: true },
      move(10, 0.6, 0.6),
      { t: 10.2, x: 0.6, y: 0.6, click: true },
      // Idle, then a continuous reach down to the recording bar and a click on it.
      ...Array.from({ length: 12 }, (_, i) =>
        move(13 + i * 0.05, 0.6, 0.6 + i * 0.03),
      ),
      { t: 13.6, x: 0.5, y: 0.95, click: true },
    ];
    const { project, summary } = autoEdit(recording(14, points), {
      stop: "bar",
      bar: { x: 0.4, y: 0.9, width: 0.2, height: 0.08 },
    });
    expect(project.trimStart).toBeCloseTo(2.5, 5);
    expect(project.trimEnd).toBeCloseTo(13.2, 5);
    expect(summary.trimmed).toBeCloseTo(2.5 + 0.8, 5);
    // The click on the bar never becomes a zoom.
    expect(autoZooms(project).every((z) => z.start < project.trimEnd)).toBe(
      true,
    );
    expect(
      autoZooms(project).some((z) => z.focus?.some((f) => f.y > 0.9)),
    ).toBe(false);
  });
  it("ends just before the stop shortcut", () => {
    const { project } = autoEdit(
      recording(9, [
        { t: 1, x: 0.5, y: 0.5, click: true },
        { t: 8.5, x: 0.5, y: 0.5, shortcut: "Ctrl + Shift + R" },
      ]),
      { stop: "hotkey" },
    );
    expect(project.trimEnd).toBeCloseTo(8.35, 5);
  });
  it("speeds up typing and idle stretches, marking both as automatic", () => {
    const typing = Array.from({ length: 8 }, (_, i): Point => ({
      ...move(2 + i * 0.2),
      typing: true,
    }));
    const p = recording(
      20,
      [{ ...move(1), click: true }, ...typing, { ...move(15), click: true }],
      [
        [1, 0.05],
        [4, 0.02],
        [15, 0.1],
      ],
    );
    const { project, summary } = autoEdit(p, { stop: "other" });
    const auto = project.speeds.filter((s) => s.auto);
    expect(summary.typing).toBe(1);
    expect(summary.idle).toBe(1);
    const idle = auto.find((s) => s.rate === 4)!;
    expect(idle.start).toBeCloseTo(4.5, 5);
    expect(idle.end).toBeCloseTo(14.5, 5);
    expect(auto.find((s) => s.rate === 2)!.start).toBeLessThan(2);
    expect(summary.zooms).toBe(autoZooms(project).length);
  });
  it("ignores tiny screen changes such as a blinking caret when finding idle time", () => {
    const blink = Array.from({ length: 20 }, (_, i): [number, number] => [
      3 + i * 0.5,
      0.00002,
    ]);
    expect(
      idleSections(
        recording(
          20,
          [
            { ...move(2), click: true },
            { ...move(15), click: true },
          ],
          blink,
        ),
      ),
    ).toHaveLength(1);
  });
  it("leaves very short recordings raw", () => {
    const p = recording(0.8, [{ ...move(0.2), click: true }]);
    const { project, summary } = autoEdit(p, { stop: "bar" });
    expect(project).toBe(p);
    expect(summary.applied).toBe(false);
  });
  it("without clicks still trims but makes no zooms", () => {
    const { project, summary } = autoEdit(
      recording(10, [move(0), move(4, 0.7, 0.7), { ...move(5), typing: true }]),
      { stop: "other" },
    );
    expect(summary.zooms).toBe(0);
    expect(project.trimStart).toBeGreaterThan(3);
  });
  it("goes back to raw and can be applied again", () => {
    const p = recording(
      20,
      [
        { ...move(3), click: true },
        { ...move(12), click: true },
      ],
      [
        [3, 0.1],
        [12, 0.1],
      ],
    );
    p.speeds = [{ id: "mine", start: 1, end: 2, rate: 1.5 }];
    const edited = autoEdit(p, { stop: "other" }).project;
    const raw: Project = backToRaw(edited);
    expect(raw.trimStart).toBe(0);
    expect(raw.trimEnd).toBe(20);
    expect(raw.speeds).toEqual([{ id: "mine", start: 1, end: 2, rate: 1.5 }]);
    expect(raw.settings.autoZoom).toBe(false);
    expect(raw.autoEdit).toBeUndefined();
    expect(autoEdit(raw, { stop: "other" }).project.settings.autoZoom).toBe(
      true,
    );
  });
});
