import type { Point, Project, SpeedSection } from "./types";
import { autoZooms, typingSections } from "./timeline";

/** How the take was ended; decides what "the reach for Stop" looks like. */
export type StopKind = "bar" | "hotkey" | "other";
export type AutoEditOptions = {
  stop: StopKind;
  /** Recording bar rectangle in recorded-area coordinates (0-1). */
  bar?: { x: number; y: number; width: number; height: number };
};
export type AutoEditSummary = {
  applied: boolean;
  zooms: number;
  typing: number;
  idle: number;
  /** Seconds removed from the start and end. */
  trimmed: number;
};

/** Seconds without input or real screen change before waiting gets sped up. */
const IDLE_SECONDS = 3;
const IDLE_RATE = 4;
/** Changed share of the screen that counts as "something happened". */
const ACTIVE_AREA = 0.002;
const STOP_SHORTCUT = "Ctrl + Shift + R";

const acts = (pt: Point) =>
  pt.click || pt.right || pt.wheel || pt.shortcut || pt.typing;
const inside = (pt: Point) => pt.x >= 0 && pt.x <= 1 && pt.y >= 0 && pt.y <= 1;

function firstAction(points: Point[]) {
  const origin = points[0];
  for (const pt of points) {
    if (acts(pt) && inside(pt)) return pt.t;
    if (origin && Math.hypot(pt.x - origin.x, pt.y - origin.y) > 0.01)
      return pt.t;
  }
  return undefined;
}

/** When the reach for Stop began, or undefined if it can't be told apart. */
function stopReach(p: Project, options: AutoEditOptions) {
  const points = p.points;
  if (options.stop === "hotkey") {
    const key = [...points]
      .reverse()
      .find((pt) => pt.shortcut === STOP_SHORTCUT);
    return key && p.duration - key.t < 3 ? key.t - 0.15 : undefined;
  }
  if (options.stop !== "bar") return undefined;
  const bar = options.bar;
  const onBar = (pt: Point) =>
    !inside(pt) ||
    (!!bar &&
      pt.x >= bar.x &&
      pt.x <= bar.x + bar.width &&
      pt.y >= bar.y &&
      pt.y <= bar.y + bar.height);
  let index = points.length - 1;
  while (
    index >= 0 &&
    !(
      points[index].click &&
      p.duration - points[index].t < 3 &&
      onBar(points[index])
    )
  )
    index--;
  if (index < 0) return undefined;
  // Walk back through the unbroken pointer movement that led to the bar.
  let start = index;
  while (start > 0 && points[start].t - points[start - 1].t < 0.25) start--;
  return points[start].t + 0.2;
}

/** Waiting time: gaps of 3 s+ with no input and no meaningful screen change. */
export function idleSections(p: Project): SpeedSection[] {
  if (!p.activity) return [];
  const busy = [
    ...p.points.map((pt) => pt.t),
    ...p.activity.filter(([, area]) => area >= ACTIVE_AREA).map(([t]) => t),
  ]
    .filter((t) => t >= p.trimStart && t <= p.trimEnd)
    .sort((a, b) => a - b);
  const sections: SpeedSection[] = [];
  for (let i = 1; i < busy.length; i++) {
    const gap = busy[i] - busy[i - 1];
    if (gap < IDLE_SECONDS) continue;
    sections.push({
      id: `auto-idle-${busy[i - 1]}`,
      start: busy[i - 1] + 0.5,
      end: busy[i] - 0.5,
      rate: IDLE_RATE,
      auto: true,
    });
  }
  return sections;
}

/**
 * The rough cut made the moment recording stops: trim dead air, speed up
 * typing and waiting, and zoom to clicks. Everything it adds is marked so it
 * can be removed one piece at a time or all at once (backToRaw).
 */
export function autoEdit(
  p: Project,
  options: AutoEditOptions,
): { project: Project; summary: AutoEditSummary } {
  const none = { applied: false, zooms: 0, typing: 0, idle: 0, trimmed: 0 };
  if (p.duration < 1) return { project: p, summary: none };
  const raw = backToRaw(p);
  const first = firstAction(raw.points);
  const trimStart = first !== undefined ? Math.max(0, first - 0.5) : 0;
  const reach = stopReach(raw, options);
  const trimEnd =
    reach !== undefined
      ? Math.min(raw.duration, Math.max(trimStart + 1, reach))
      : raw.duration;
  const trimmed: Project = {
    ...raw,
    trimStart,
    trimEnd,
    autoEdit: { trimStart: raw.trimStart, trimEnd: raw.trimEnd },
    settings: { ...raw.settings, autoZoom: true },
  };
  const typing = typingSections(trimmed).map((s, i) => ({
    ...s,
    id: `auto-typing-${i}`,
    auto: true,
  }));
  const idle = idleSections(trimmed).filter(
    (s) => !typing.some((t) => s.start < t.end && t.start < s.end),
  );
  const project = {
    ...trimmed,
    speeds: [...raw.speeds, ...typing, ...idle],
  };
  return {
    project,
    summary: {
      applied: true,
      zooms: autoZooms(project).filter((z) => z.id.startsWith("auto-")).length,
      typing: typing.length,
      idle: idle.length,
      trimmed: trimStart + (raw.duration - trimEnd),
    },
  };
}

/** Undo the whole automatic pass, keeping everything added by hand. */
export function backToRaw(p: Project): Project {
  if (!p.autoEdit) return p;
  const { autoEdit: _, ...rest } = p;
  void _;
  return {
    ...rest,
    trimStart: p.autoEdit.trimStart,
    trimEnd: p.autoEdit.trimEnd,
    speeds: p.speeds.filter((s) => !s.auto),
    settings: { ...p.settings, autoZoom: false },
  };
}

/** One line for the toast: "7 zooms · 2 typing speed-ups · trimmed 4 s". */
export function describeSummary(summary: AutoEditSummary) {
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? "" : "s"}`;
  const parts = [
    plural(summary.zooms, "zoom"),
    summary.typing && plural(summary.typing, "typing speed-up"),
    summary.idle && plural(summary.idle, "idle speed-up"),
    summary.trimmed >= 0.5 && `trimmed ${Math.round(summary.trimmed)} s`,
  ].filter(Boolean);
  return parts.join(" · ");
}
