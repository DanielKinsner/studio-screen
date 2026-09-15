import { useRef, useState } from "react";
import { clamp } from "./timeline";
type Range = { start: number; end: number };

/** How the timeline maps source time onto its collapsed (ripple-aware) axis. */
export type Axis = {
  /** Timeline length in seconds: the source duration minus ripple cuts. */
  total: number;
  /** Source duration in seconds. */
  duration: number;
  /** Source time → timeline seconds. */
  tl: (t: number) => number;
  /** Timeline seconds → source time. */
  src: (x: number) => number;
};
/** Where source time t sits across the timeline, in percent. */
export const percent = (axis: Axis, t: number) =>
  (axis.tl(t) / axis.total) * 100;

export default function TimelineClip({
  id,
  start,
  end,
  axis,
  label,
  kind,
  selected,
  onSelect,
  onChange,
  auto,
  onRemove,
  snap,
  onSnapLine,
}: Range & {
  id: string;
  axis: Axis;
  label: string;
  kind: string;
  selected: boolean;
  onSelect: () => void;
  onChange: (v: Range) => void;
  /** Made by the automatic edit: dashed, with a one-click remove. */
  auto?: boolean;
  onRemove?: () => void;
  /** Snap a timeline position (seconds), ignoring this clip's own edges. */
  snap?: (x: number, exclude: string) => number;
  /** Show (or with null, hide) the snap line at a timeline position. */
  onSnapLine?: (x: number | null) => void;
}) {
  const [draft, setDraft] = useState<Range | null>(null);
  const drag = useRef<{
    x: number;
    width: number;
    mode: string;
    a: number;
    b: number;
    value: Range;
    changed: boolean;
  } | null>(null);
  const v = draft || { start, end };
  const left = percent(axis, v.start);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      className={`${kind}-clip draggable-clip ${selected ? "selected" : ""} ${auto ? "auto" : ""}`}
      style={{
        left: `${left}%`,
        width: `${percent(axis, v.end) - left}%`,
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.button !== 0) return;
        e.preventDefault();
        onSelect();
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = {
          x: e.clientX,
          width: e.currentTarget.parentElement!.getBoundingClientRect().width,
          mode: (e.target as HTMLElement).dataset.edge || "move",
          a: axis.tl(start),
          b: axis.tl(end),
          value: { start, end },
          changed: false,
        };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const delta = ((e.clientX - d.x) / d.width) * axis.total;
        d.changed = d.changed || Math.abs(e.clientX - d.x) > 3;
        const to = (x: number) => (snap ? snap(x, id) : x);
        let next: Range,
          line: number | null = null;
        if (d.mode === "start") {
          const x = to(d.a + delta);
          if (x !== d.a + delta) line = x;
          next = { start: clamp(axis.src(x), 0, end - 0.1), end };
        } else if (d.mode === "end") {
          const x = to(d.b + delta);
          if (x !== d.b + delta) line = x;
          next = {
            start,
            end: clamp(axis.src(x), start + 0.1, axis.duration),
          };
        } else {
          // Moving: whichever edge is closer to a snap target wins.
          const a = d.a + delta,
            b = d.b + delta;
          const sa = to(a) - a,
            sb = to(b) - b;
          let shift = 0;
          if (sa && (!sb || Math.abs(sa) <= Math.abs(sb))) {
            shift = sa;
            line = a + sa;
          } else if (sb) {
            shift = sb;
            line = b + sb;
          }
          const length = d.b - d.a;
          const from = clamp(a + shift, 0, Math.max(0, axis.total - length));
          next = { start: axis.src(from), end: axis.src(from + length) };
        }
        d.value = next;
        setDraft(next);
        onSnapLine?.(d.changed ? line : null);
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        const d = drag.current;
        drag.current = null;
        setDraft(null);
        onSnapLine?.(null);
        if (d?.changed) onChange(d.value);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDraft(null);
        onSnapLine?.(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          e.stopPropagation();
          const delta =
            (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 0.1);
          if (e.altKey)
            onChange({
              start,
              end: clamp(end + delta, start + 0.1, axis.duration),
            });
          else {
            const a = clamp(start + delta, 0, axis.duration - (end - start));
            onChange({ start: a, end: a + end - start });
          }
        }
      }}
      title={`${label} · ${v.start.toFixed(1)}–${v.end.toFixed(1)}s. Drag to move; drag edges to resize. Arrow keys move; Alt+arrows resize.`}
    >
      <span className="clip-edge" data-edge="start" />
      <span className="clip-text">{label}</span>
      {auto && onRemove && (
        <button
          className="clip-remove"
          aria-label={`Remove automatic ${label}`}
          title="Remove this automatic edit"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      )}
      <span className="clip-edge" data-edge="end" />
    </div>
  );
}
