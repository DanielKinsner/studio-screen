import { Box, Focus, Plus, Sparkles, Trash2, ZoomIn } from "lucide-react";
import type { Project, Zoom } from "./types";
import { autoZooms, clamp, timecode } from "./timeline";
import { tiltPresets } from "./motion";
import { Slider, Toggle, IconButton } from "./Controls";
export type PanelProps = {
  project: Project;
  edit: (fn: (p: Project) => Project) => void;
  notify: (s: string) => void;
};
export default function MotionPanel({
  project: p,
  edit,
  notify,
  selected,
  onSelect,
  onAdd,
}: {
  selected: string | null;
  onSelect: (id: string, t: number) => void;
  onAdd: (mode: "2d" | "3d") => void;
} & PanelProps) {
  const zooms = autoZooms(p),
    z = zooms.find((z) => z.id === selected);
  const s = p.settings;
  const update = (value: Partial<Zoom>) => {
    if (!z) return;
    edit((p) => ({
      ...p,
      zooms: p.zooms.some((v) => v.id === z.id)
        ? p.zooms.map((v) => (v.id === z.id ? { ...v, ...value } : v))
        : [...p.zooms, { ...z, id: z.id, ...value }],
    }));
  };
  const setting = (value: Partial<Project["settings"]>) =>
    edit((p) => ({ ...p, settings: { ...p.settings, ...value } }));
  const mode = z ? z.mode || s.motionMode : s.motionMode;
  return (
    <>
      <div className="panel-intro">
        <span className="eyebrow">FOCUS & MOVEMENT</span>
        <h2>Give your screen some depth.</h2>
        <p>
          Choose a look, add a focus moment, then fine-tune it on the timeline.
        </p>
      </div>
      <div className="motion-mode-picker">
        {(["2d", "3d"] as const).map((m) => (
          <button
            key={m}
            className={mode === m ? "selected" : ""}
            aria-pressed={mode === m}
            onClick={() =>
              z
                ? update({ mode: m, follow: m === "3d" ? false : z.follow })
                : setting({ motionMode: m })
            }
          >
            <span className={`motion-tile ${m}`}>
              <span />
            </span>
            <strong>{m === "3d" ? "3D perspective" : "Classic zoom"}</strong>
            <small>
              {m === "3d" ? "Depth, tilt & rotation" : "Clean, direct focus"}
            </small>
          </button>
        ))}
      </div>
      <div className="button-pair">
        <button className="button primary" onClick={() => onAdd("3d")}>
          <Box size={15} />
          Add 3D zoom
        </button>
        <button className="button" onClick={() => onAdd("2d")}>
          <ZoomIn size={15} />
          Add 2D
        </button>
      </div>
      {z ? (
        <section className="selected-edit">
          <div className="section-title">
            <h2>
              <Focus size={14} />
              Selected focus
            </h2>
            <IconButton
              label="Delete focus"
              onClick={() => {
                edit((p) => ({
                  ...p,
                  zooms: p.zooms.filter((v) => v.id !== z.id),
                  dismissedZooms: z.id.startsWith("auto-")
                    ? [...p.dismissedZooms, z.id]
                    : p.dismissedZooms,
                }));
                notify("Focus removed. Undo to restore it.");
              }}
            >
              <Trash2 size={14} />
            </IconButton>
          </div>
          <div className="two-fields">
            <label>
              Start (sec)
              <input
                aria-label="Zoom start"
                type="number"
                step={0.1}
                value={+z.start.toFixed(2)}
                onChange={(e) =>
                  update({ start: clamp(+e.target.value, 0, z.end - 0.1) })
                }
              />
            </label>
            <label>
              End (sec)
              <input
                aria-label="Zoom end"
                type="number"
                step={0.1}
                value={+z.end.toFixed(2)}
                onChange={(e) =>
                  update({
                    end: clamp(+e.target.value, z.start + 0.1, p.duration),
                  })
                }
              />
            </label>
          </div>
          <Slider
            label="Magnification"
            value={z.scale}
            min={1.05}
            max={4}
            step={0.05}
            unit="×"
            onChange={(scale) => update({ scale })}
          />
          {mode === "3d" && (
            <>
              <Toggle
                label="Follow recorded cursor"
                checked={z.follow !== false}
                description={
                  p.demo || p.points.length
                    ? "Tilt follows recorded pointer movement"
                    : "No cursor metadata: manual tilt is used"
                }
                onChange={(follow) => update({ follow })}
              />
              {z.follow === false || (!p.demo && !p.points.length) ? (
                <>
                  <div className="tilt-presets">
                    {tiltPresets.map((v) => (
                      <button
                        key={v.name}
                        onClick={() => update({ ...v.value, follow: false })}
                      >
                        <span
                          style={{
                            transform: `perspective(100px) rotateX(${v.value.tiltX}deg) rotateY(${v.value.tiltY}deg) rotateZ(${v.value.tiltZ}deg)`,
                          }}
                        />
                        {v.name}
                      </button>
                    ))}
                  </div>
                  <Slider
                    label="Tilt up / down"
                    min={-40}
                    max={40}
                    value={z.tiltX ?? -10}
                    unit="°"
                    onChange={(tiltX) => update({ tiltX })}
                  />
                  <Slider
                    label="Tilt left / right"
                    min={-40}
                    max={40}
                    value={z.tiltY ?? 18}
                    unit="°"
                    onChange={(tiltY) => update({ tiltY })}
                  />
                  <Slider
                    label="Rotation"
                    min={-30}
                    max={30}
                    value={z.tiltZ ?? -2}
                    unit="°"
                    onChange={(tiltZ) => update({ tiltZ })}
                  />
                </>
              ) : (
                <Slider
                  label="3D intensity"
                  min={5}
                  max={40}
                  value={s.motionIntensity}
                  unit="°"
                  onChange={(motionIntensity) => setting({ motionIntensity })}
                />
              )}
              <details className="advanced-controls">
                <summary>Position & perspective</summary>
                <Slider
                  label="Horizontal position"
                  min={-60}
                  max={60}
                  value={z.offsetX || 0}
                  unit="%"
                  onChange={(offsetX) => update({ offsetX })}
                />
                <Slider
                  label="Vertical position"
                  min={-60}
                  max={60}
                  value={z.offsetY || 0}
                  unit="%"
                  onChange={(offsetY) => update({ offsetY })}
                />
                <Slider
                  label="Field of view"
                  min={25}
                  max={75}
                  value={z.perspective || 45}
                  unit="°"
                  onChange={(perspective) => update({ perspective })}
                />
              </details>
            </>
          )}
          <details className="advanced-controls">
            <summary>Focus point</summary>
            <Slider
              label="Focus X"
              value={z.x * 100}
              unit="%"
              onChange={(x) => update({ x: x / 100 })}
            />
            <Slider
              label="Focus Y"
              value={z.y * 100}
              unit="%"
              onChange={(y) => update({ y: y / 100 })}
            />
            <p>These controls select the part of the recording to magnify.</p>
          </details>
        </section>
      ) : (
        <p className="helper-text">
          Select a focus clip on the timeline to edit its angle, timing, and
          target.
        </p>
      )}
      <details className="advanced-controls" open={!z}>
        <summary>Automatic focus & animation</summary>
        <Toggle
          label="Automatic zoom"
          checked={s.autoZoom}
          onChange={(autoZoom) => setting({ autoZoom })}
          description="Create focus moments from captured clicks"
        />
        <Slider
          label="Zoom strength"
          value={s.zoomStrength}
          min={1.1}
          max={3}
          step={0.05}
          unit="×"
          onChange={(zoomStrength) => setting({ zoomStrength })}
        />
        <Toggle
          label="Pan with cursor"
          checked={s.followCursor}
          onChange={(followCursor) => setting({ followCursor })}
        />
        <label className="select-field">
          <span>Movement</span>
          <select
            aria-label="Movement style"
            value={s.motionEase}
            onChange={(e) =>
              setting({ motionEase: e.target.value as typeof s.motionEase })
            }
          >
            <option value="focused">Focused · quick settle</option>
            <option value="smooth">Smooth · balanced</option>
            <option value="gentle">Gentle · slow glide</option>
          </select>
        </label>
        <Slider
          label="Motion blur"
          value={s.motionBlur}
          unit="%"
          onChange={(motionBlur) => setting({ motionBlur })}
        />
        <p className="helper-text">
          Motion blur samples the moving screen and cursor. The same effect is
          included in exports.
        </p>
      </details>
      <div className="section-title">
        <h2>Focus moments</h2>
        <span className="count-badge">{zooms.length}</span>
      </div>
      <div className="edit-list">
        {zooms.map((v) => (
          <button
            key={v.id}
            className={selected === v.id ? "active" : ""}
            onClick={() => onSelect(v.id, (v.start + v.end) / 2)}
          >
            {(v.mode || s.motionMode) === "3d" ? (
              <Box size={15} />
            ) : (
              <ZoomIn size={15} />
            )}
            <span>
              {(v.mode || s.motionMode) === "3d"
                ? "3D perspective"
                : "2D focus"}
              <small>
                {timecode(v.start)} – {timecode(v.end)} · {v.scale.toFixed(1)}×
              </small>
            </span>
            {v.id.startsWith("auto-") && <Sparkles size={12} />}
          </button>
        ))}
      </div>
    </>
  );
}
