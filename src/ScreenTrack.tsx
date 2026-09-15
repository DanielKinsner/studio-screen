import { useState, type ReactNode } from "react";
import { FileVideo } from "lucide-react";
import type { Project } from "./types";
import { percent, type Axis } from "./TimelineClip";
import { pieces, type Edge, type Piece } from "./edits";
import { timecode } from "./timeline";

export type MenuTarget =
  | { kind: "piece"; piece: Piece }
  | { kind: "gap"; id: string }
  | { kind: "ripple"; id: string };

const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/**
 * The footage track: pieces between split points, dimmed hatched gaps,
 * markers where rippled footage collapsed, trim grips on the outer edges and
 * the razor's hover line. Edits are reported up; this only draws and routes.
 */
export default function ScreenTrack({
  project: p,
  axis,
  selected,
  tool,
  title,
  strip,
  onSelect,
  onScrub,
  onSplit,
  onEdgeDrag,
  onMenu,
  snap,
}: {
  /** The project as drawn (a live draft while an edit point is dragged). */
  project: Project;
  axis: Axis;
  selected: string | null;
  tool: "select" | "razor";
  title: string;
  /** Filmstrip thumbnails for the trimmed footage. */
  strip: ReactNode;
  onSelect: (id: string) => void;
  onScrub: (e: React.PointerEvent) => void;
  onSplit: (t: number) => void;
  onEdgeDrag: (e: React.PointerEvent, edge: Edge, at: number) => void;
  onMenu: (e: React.MouseEvent, target: MenuTarget) => void;
  snap: (x: number) => number;
}) {
  const [razorAt, setRazorAt] = useState<number | null>(null);
  const list = pieces(p);
  const at = (e: React.PointerEvent) => {
    const box = e.currentTarget.closest(".screen-track")!.getBoundingClientRect();
    return snap(((e.clientX - box.left) / box.width) * axis.total);
  };
  const edgeOf = (piece: Piece, side: "start" | "end"): Edge | null => {
    if (side === "end") {
      if (same(piece.end, p.trimEnd)) return null;
      const cut = p.cuts.find((c) => same(c.start, piece.end));
      return cut
        ? { kind: "cut-start", id: cut.id }
        : { kind: "split", at: piece.end, side: "left" };
    }
    if (same(piece.start, p.trimStart)) return null;
    const cut = p.cuts.find((c) => same(c.end, piece.start));
    return cut
      ? { kind: "cut-end", id: cut.id }
      : { kind: "split", at: piece.start, side: "right" };
  };
  const trimLeft = percent(axis, p.trimStart);
  return (
    <div
      className={`screen-track ${tool === "razor" ? "razor" : ""}`}
      onPointerMove={(e) =>
        setRazorAt(tool === "razor" && e.buttons === 0 ? at(e) : null)
      }
      onPointerLeave={() => setRazorAt(null)}
    >
      <div
        className="screen-clip"
        style={{
          left: `${trimLeft}%`,
          width: `${percent(axis, p.trimEnd) - trimLeft}%`,
        }}
      >
        {strip}
        <div className="clip-title">
          <FileVideo size={12} />
          {title}
        </div>
        <span
          className="clip-grip"
          title="Drag to trim the start"
          onPointerDown={(e) =>
            onEdgeDrag(e, { kind: "trim-start" }, p.trimStart)
          }
        >
          Ⅱ
        </span>
        <span
          className="clip-grip end"
          title="Drag to trim the end"
          onPointerDown={(e) => onEdgeDrag(e, { kind: "trim-end" }, p.trimEnd)}
        >
          Ⅱ
        </span>
      </div>
      {list.map((piece, i) => {
        const left = percent(axis, piece.start);
        const start = edgeOf(piece, "start"),
          end = edgeOf(piece, "end");
        return (
          <div
            key={piece.id}
            role="button"
            tabIndex={-1}
            aria-label={`Clip ${timecode(piece.start)} to ${timecode(piece.end)}`}
            aria-pressed={selected === piece.id}
            className={`screen-piece ${i && same(piece.start, list[i - 1].end) ? "divided" : ""} ${selected === piece.id ? "selected" : ""}`}
            style={{
              left: `${left}%`,
              width: `${percent(axis, piece.end) - left}%`,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.button !== 0) return;
              if (tool === "razor") {
                onSplit(axis.src(at(e)));
                return;
              }
              onSelect(piece.id);
              onScrub(e);
            }}
            onContextMenu={(e) => onMenu(e, { kind: "piece", piece })}
          >
            {start && tool === "select" && (
              <span
                className="piece-edge"
                data-edge="start"
                title="Drag to remove footage · Shift+drag to ripple"
                onPointerDown={(e) => onEdgeDrag(e, start, piece.start)}
              />
            )}
            {end && tool === "select" && (
              <span
                className="piece-edge"
                data-edge="end"
                title="Drag to remove footage · Shift+drag to ripple"
                onPointerDown={(e) => onEdgeDrag(e, end, piece.end)}
              />
            )}
          </div>
        );
      })}
      {p.cuts
        .filter((c) => !c.ripple && c.end > p.trimStart && c.start < p.trimEnd)
        .map((c) => {
          const left = percent(axis, Math.max(c.start, p.trimStart));
          return (
            <button
              key={c.id}
              title={`Gap ${timecode(c.start)} to ${timecode(c.end)} · Delete closes it · right-click for more`}
              aria-label={`Gap ${timecode(c.start)} to ${timecode(c.end)}`}
              aria-pressed={selected === c.id}
              className={`cut-region ${selected === c.id ? "selected" : ""}`}
              style={{
                left: `${left}%`,
                width: `${percent(axis, Math.min(c.end, p.trimEnd)) - left}%`,
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (e.button === 0) onSelect(c.id);
              }}
              onContextMenu={(e) => onMenu(e, { kind: "gap", id: c.id })}
            >
              <span
                className="piece-edge"
                data-edge="start"
                onPointerDown={(e) =>
                  onEdgeDrag(e, { kind: "cut-start", id: c.id }, c.start)
                }
              />
              <span
                className="piece-edge"
                data-edge="end"
                onPointerDown={(e) =>
                  onEdgeDrag(e, { kind: "cut-end", id: c.id }, c.end)
                }
              />
            </button>
          );
        })}
      {p.cuts
        .filter((c) => c.ripple && c.end > p.trimStart && c.start < p.trimEnd)
        .map((c) => (
          <button
            key={c.id}
            className="ripple-marker"
            aria-label={`Removed ${(c.end - c.start).toFixed(1)} s`}
            title={`Removed ${(c.end - c.start).toFixed(1)} s: right-click to restore`}
            style={{ left: `${percent(axis, c.start)}%` }}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => onMenu(e, { kind: "ripple", id: c.id })}
          />
        ))}
      {razorAt !== null && (
        <span
          className="razor-line"
          style={{ left: `${(razorAt / axis.total) * 100}%` }}
        />
      )}
    </div>
  );
}
