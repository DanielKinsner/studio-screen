import { describe, expect, it } from "vitest";
import { parseEvents } from "./nativeEvents";

const lines = (...items: object[]) =>
  items.map((i) => JSON.stringify(i)).join("\n");

describe("Capture helper event log", () => {
  it("turns pointer, clicks, wheel, shortcuts, typing and cursor shape into points", () => {
    const { points, activity } = parseEvents(
      lines(
        { t: 0, k: "f", a: 1 },
        { t: 0.01, k: "m", x: 0.2, y: 0.3 },
        { t: 0.02, k: "c", c: "arrow" },
        { t: 0.5, k: "d", b: "left", x: 0.25, y: 0.35 },
        { t: 0.55, k: "u", b: "left", x: 0.25, y: 0.35 },
        { t: 0.9, k: "d", b: "right", x: 0.3, y: 0.4 },
        { t: 1.1, k: "w", d: -120, h: false, x: 0.3, y: 0.4 },
        { t: 1.2, k: "s", s: "Ctrl + K" },
        { t: 1.3, k: "y" },
        { t: 1.4, k: "c", c: "text" },
        { t: 1.5, k: "f", a: 0.0125 },
      ),
    );
    expect(points).toEqual([
      { t: 0.01, x: 0.2, y: 0.3 },
      { t: 0.02, x: 0.2, y: 0.3, cursor: "arrow" },
      { t: 0.5, x: 0.25, y: 0.35, click: true },
      { t: 0.9, x: 0.3, y: 0.4, right: true },
      { t: 1.1, x: 0.3, y: 0.4, wheel: -120 },
      { t: 1.2, x: 0.3, y: 0.4, shortcut: "Ctrl + K" },
      { t: 1.3, x: 0.3, y: 0.4, typing: true },
      { t: 1.4, x: 0.3, y: 0.4, cursor: "text" },
    ]);
    expect(activity).toEqual([
      [0, 1],
      [1.5, 0.0125],
    ]);
  });
  it("survives a log cut off mid-line by a crash and sorts late arrivals", () => {
    const text =
      lines(
        { t: 0.2, k: "m", x: 0.5, y: 0.5 },
        { t: 0.1, k: "m", x: 0.4, y: 0.4 },
      ) + '\n{"t":0.3,"k":"m","x":0.';
    expect(parseEvents(text).points.map((p) => p.t)).toEqual([0.1, 0.2]);
  });
  it("places events that arrive before any pointer sample at the centre", () => {
    expect(parseEvents(lines({ t: 0.4, k: "y" })).points).toEqual([
      { t: 0.4, x: 0.5, y: 0.5, typing: true },
    ]);
  });
});
