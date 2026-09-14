import type { Point } from "./types";

/** [seconds, changed share of the recorded area] from screen dirty regions. */
export type Activity = [number, number][];

type Line = {
  t?: number;
  k?: string;
  x?: number;
  y?: number;
  b?: string;
  d?: number;
  s?: string;
  c?: string;
  a?: number;
};

/**
 * Read the capture helper's JSON-lines log. A log cut off by a crash simply
 * ends early; any unreadable line is skipped.
 */
export function parseEvents(text: string): {
  points: Point[];
  activity: Activity;
} {
  const points: Point[] = [];
  const activity: Activity = [];
  let x = 0.5,
    y = 0.5;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let e: Line;
    try {
      e = JSON.parse(raw);
    } catch {
      continue;
    }
    const t = e.t;
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0) continue;
    const at = () => {
      if (Number.isFinite(e.x) && Number.isFinite(e.y)) {
        x = e.x!;
        y = e.y!;
      }
      return { t, x, y };
    };
    switch (e.k) {
      case "m":
        points.push(at());
        break;
      case "d":
        if (e.b === "left") points.push({ ...at(), click: true });
        else if (e.b === "right") points.push({ ...at(), right: true });
        break;
      case "w":
        if (Number.isFinite(e.d)) points.push({ ...at(), wheel: e.d });
        break;
      case "s":
        if (e.s) points.push({ ...at(), shortcut: e.s.slice(0, 60) });
        break;
      case "y":
        points.push({ ...at(), typing: true });
        break;
      case "c":
        if (e.c) points.push({ ...at(), cursor: e.c.slice(0, 20) });
        break;
      case "f":
        if (Number.isFinite(e.a)) activity.push([t, e.a!]);
        break;
    }
  }
  points.sort((a, b) => a.t - b.t);
  activity.sort((a, b) => a[0] - b[0]);
  return { points, activity };
}
