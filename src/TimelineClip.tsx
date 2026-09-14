import { useRef, useState } from "react";
import { clamp } from "./timeline";
type Range = { start: number; end: number };
export default function TimelineClip({
  start,
  end,
  duration,
  label,
  kind,
  selected,
  onSelect,
  onChange,
}: Range & {
  duration: number;
  label: string;
  kind: string;
  selected: boolean;
  onSelect: () => void;
  onChange: (v: Range) => void;
}) {
  const [draft, setDraft] = useState<Range | null>(null);
  const drag = useRef<{
    x: number;
    width: number;
    mode: string;
    value: Range;
    changed: boolean;
  } | null>(null);
  const v = draft || { start, end };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      className={`${kind}-clip draggable-clip ${selected ? "selected" : ""}`}
      style={{
        left: `${(v.start / duration) * 100}%`,
        width: `${((v.end - v.start) / duration) * 100}%`,
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onSelect();
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = {
          x: e.clientX,
          width: e.currentTarget.parentElement!.getBoundingClientRect().width,
          mode: (e.target as HTMLElement).dataset.edge || "move",
          value: { start, end },
          changed: false,
        };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const d = drag.current,
          delta = ((e.clientX - d.x) / d.width) * duration;
        d.changed = d.changed || Math.abs(e.clientX - d.x) > 3;
        let next;
        if (d.mode === "start")
          next = { start: clamp(start + delta, 0, end - 0.1), end };
        else if (d.mode === "end")
          next = { start, end: clamp(end + delta, start + 0.1, duration) };
        else {
          const a = clamp(start + delta, 0, duration - (end - start));
          next = { start: a, end: a + end - start };
        }
        d.value = next;
        setDraft(next);
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        const d = drag.current;
        drag.current = null;
        setDraft(null);
        if (d?.changed) onChange(d.value);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDraft(null);
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
            onChange({ start, end: clamp(end + delta, start + 0.1, duration) });
          else {
            const a = clamp(start + delta, 0, duration - (end - start));
            onChange({ start: a, end: a + end - start });
          }
        }
      }}
      title={`${label} · ${v.start.toFixed(1)}–${v.end.toFixed(1)}s. Drag to move; drag edges to resize. Arrow keys move; Alt+arrows resize.`}
    >
      <span className="clip-edge" data-edge="start" />
      <span className="clip-text">{label}</span>
      <span className="clip-edge" data-edge="end" />
    </div>
  );
}
