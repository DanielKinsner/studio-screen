// Premiere-style cutting on a collapsed timeline. Everything stays stored in
// source (recording) time: split points divide the footage into pieces,
// deleting a piece adds a cut, and a ripple cut is simply drawn at zero width
// so the timeline closes up. Nothing is ever re-timed, so zooms, speeds and
// cursor data keep working untouched.
import type { Cut, Project, Range, Zoom } from "./types";
import { memo } from "./spring";
import { outputDuration, visibleSegments } from "./timeline";

/** One frame at 60 fps: the closest two edit points may be. */
export const FRAME = 1 / 60;
/** No edit may leave less output than this. */
export const MIN_OUTPUT = 0.25;

export type Piece = { id: string; start: number; end: number };

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const newId = () => crypto.randomUUID();

/** Split points inside the trim range, sorted and unique. */
const splitsOf = memo((splits: number[] | undefined, start: number, end: number) =>
  [...new Set(splits || [])]
    .filter((t) => Number.isFinite(t) && t > start && t < end)
    .sort((a, b) => a - b),
);

/** Kept footage between the trim ends, split points and cuts, in order. */
export const pieces = (p: Project): Piece[] =>
  piecesOf(p.cuts, p.splits, p.trimStart, p.trimEnd);
const piecesOf = memo(
  (
    cuts: Cut[],
    splits: number[] | undefined,
    trimStart: number,
    trimEnd: number,
  ) => {
    const inside = splitsOf(splits, trimStart, trimEnd);
    return visibleSegments({ cuts, trimStart, trimEnd } as Project).flatMap(
      (segment) => {
        const edges = [
          segment.start,
          ...inside.filter((t) => t > segment.start && t < segment.end),
          segment.end,
        ];
        return edges
          .slice(0, -1)
          .map((start, i) => ({ id: `piece:${start}`, start, end: edges[i + 1] }))
          .filter((piece) => piece.end - piece.start > 1e-6);
      },
    );
  },
);

/** Every edit point: trim ends, split points inside the trim, cut edges. */
export function editPoints(p: Project) {
  return [
    ...new Set([
      p.trimStart,
      p.trimEnd,
      ...splitsOf(p.splits, p.trimStart, p.trimEnd),
      ...p.cuts
        .flatMap((c) => [c.start, c.end])
        .filter((t) => t >= p.trimStart && t <= p.trimEnd),
    ]),
  ].sort((a, b) => a - b);
}

/** Split the piece under t; a no-op within a frame of an existing edit point. */
export function splitAt(p: Project, t: number): Project {
  const piece = pieces(p).find((x) => t > x.start && t < x.end);
  if (!piece || t - piece.start < FRAME || piece.end - t < FRAME) return p;
  if ((p.splits || []).some((s) => Math.abs(s - t) < FRAME)) return p;
  return { ...p, splits: [...(p.splits || []), t].sort((a, b) => a - b) };
}

/**
 * What ripple-removing [a, b] does to everything else, in the same step:
 * items fully inside are deleted, items crossing an edge are clipped to the
 * kept footage, and focus keyframes inside are dropped.
 */
export function rippleItems(p: Project, a: number, b: number): Project {
  const clip = <T extends Range>(items: T[]) =>
    items.flatMap((item): T[] => {
      if (item.start >= a && item.end <= b) return [];
      if (item.start < a && item.end > a && item.end <= b)
        return [{ ...item, end: a }];
      if (item.start >= a && item.start < b && item.end > b)
        return [{ ...item, start: b }];
      return [item];
    });
  const zooms = clip(p.zooms).map((z): Zoom => {
    if (!z.focus) return z;
    const focus = z.focus.filter((f) => f.t < a || f.t >= b);
    return focus.length === z.focus.length
      ? z
      : { ...z, focus: focus.length ? focus : undefined };
  });
  return {
    ...p,
    zooms,
    speeds: clip(p.speeds),
    captions: clip(p.captions),
    annotations: clip(p.annotations),
    hiddenCursor: clip(p.hiddenCursor),
  };
}

const guarded = (before: Project, after: Project) =>
  outputDuration(after) < MIN_OUTPUT ? before : after;

/** Delete a piece: leave a gap, or ripple (remove it and close up). */
export function deletePiece(
  p: Project,
  piece: { start: number; end: number },
  options: { ripple: boolean; id?: string },
): Project {
  const cut: Cut = {
    id: options.id ?? newId(),
    start: piece.start,
    end: piece.end,
    ...(options.ripple ? { ripple: true } : {}),
  };
  const next = guarded(p, { ...p, cuts: [...p.cuts, cut] });
  if (next === p) return p;
  return options.ripple ? rippleItems(next, piece.start, piece.end) : next;
}

/** Close a gap: it becomes a ripple cut, like deleting a gap in Premiere. */
export function closeGap(p: Project, id: string): Project {
  const cut = p.cuts.find((c) => c.id === id);
  if (!cut || cut.ripple) return p;
  return rippleItems(
    {
      ...p,
      cuts: p.cuts.map((c) => (c.id === id ? { ...c, ripple: true } : c)),
    },
    cut.start,
    cut.end,
  );
}

/** Bring removed footage back. Items a ripple deleted return only via undo. */
export function restore(p: Project, id: string): Project {
  if (!p.cuts.some((c) => c.id === id)) return p;
  return { ...p, cuts: p.cuts.filter((c) => c.id !== id) };
}

/** Ripple-removed source ranges, merged and sorted. */
const rippleRanges = memo((cuts: Cut[], duration: number) => {
  const ranges: [number, number][] = [];
  for (const c of cuts
    .filter((c) => c.ripple)
    .map((c): [number, number] => [
      Math.max(0, c.start),
      Math.min(duration, c.end),
    ])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])) {
    const last = ranges.at(-1);
    if (last && c[0] <= last[1]) last[1] = Math.max(last[1], c[1]);
    else ranges.push([...c]);
  }
  return ranges;
});

/** Where source time t sits on the timeline: ripple cuts take no width. */
export function timelineTime(p: Project, t: number) {
  let removed = 0;
  for (const [a, b] of rippleRanges(p.cuts, p.duration)) {
    if (t <= a) break;
    removed += Math.min(t, b) - a;
  }
  return t - removed;
}

/** The source time at timeline position x (a collapse point opens onto what follows). */
export function sourceFromTimeline(p: Project, x: number) {
  let t = x;
  for (const [a, b] of rippleRanges(p.cuts, p.duration)) {
    if (t < a) break;
    t += b - a;
  }
  return t;
}

/** Length of the timeline: the source duration minus ripple cuts. */
export const timelineDuration = (p: Project) => timelineTime(p, p.duration);

/** A draggable edit point on the screen track. */
export type Edge =
  | { kind: "trim-start" }
  | { kind: "trim-end" }
  | { kind: "cut-start"; id: string }
  | { kind: "cut-end"; id: string }
  /** A split point; `side` is where the dragged piece sits. */
  | { kind: "split"; at: number; side: "left" | "right" };

/**
 * Drag an edit point to source time `to`. Inward from a piece removes footage
 * (a gap, or a ripple with Shift); outward reclaims footage from the adjacent
 * gap only. Always computed from the project as it was when the drag began.
 */
export function dragEdge(
  p: Project,
  edge: Edge,
  to: number,
  ripple: boolean,
  id: string = newId(),
): Project {
  if (edge.kind === "trim-start")
    return guarded(p, {
      ...p,
      trimStart: Math.max(0, Math.min(to, p.trimEnd - FRAME)),
    });
  if (edge.kind === "trim-end")
    return guarded(p, {
      ...p,
      trimEnd: Math.min(p.duration, Math.max(to, p.trimStart + FRAME)),
    });
  const add = (start: number, end: number) =>
    end - start < 1e-6
      ? p
      : guarded(
          p,
          rippleOrNot(
            { ...p, cuts: [...p.cuts, { id, start, end, ...(ripple ? { ripple: true } : {}) }] },
            start,
            end,
          ),
        );
  const rippleOrNot = (next: Project, a: number, b: number) =>
    ripple ? rippleItems(next, a, b) : next;
  if (edge.kind === "split") {
    if (edge.side === "left" && to < edge.at)
      return add(Math.max(p.trimStart, to), edge.at);
    if (edge.side === "right" && to > edge.at)
      return add(edge.at, Math.min(p.trimEnd, to));
    return p;
  }
  const cut = p.cuts.find((c) => c.id === edge.id);
  if (!cut) return p;
  const grow =
    edge.kind === "cut-start" ? to < cut.start : to > cut.end;
  // Shift next to a plain gap: the newly removed part is its own ripple cut.
  if (grow && ripple && !cut.ripple)
    return edge.kind === "cut-start"
      ? add(Math.max(0, to), cut.start)
      : add(cut.end, Math.min(p.duration, to));
  const moved: Cut =
    edge.kind === "cut-start"
      ? { ...cut, start: Math.max(0, Math.min(to, cut.end - FRAME)) }
      : { ...cut, end: Math.min(p.duration, Math.max(to, cut.start + FRAME)) };
  if (near(moved.start, cut.start) && near(moved.end, cut.end)) return p;
  let next: Project = {
    ...p,
    cuts: p.cuts.map((c) => (c.id === cut.id ? moved : c)),
  };
  if (cut.ripple && grow)
    next =
      edge.kind === "cut-start"
        ? rippleItems(next, moved.start, cut.start)
        : rippleItems(next, cut.end, moved.end);
  return guarded(p, next);
}
