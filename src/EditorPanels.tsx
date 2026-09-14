import { cleanSettings, withCameraFeel } from "./settings";
import { useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Clock3,
  Copy,
  EyeOff,
  MousePointer2,
  Plus,
  Save,
  Trash2,
  WandSparkles,
} from "lucide-react";
import type { Project, Settings } from "./types";
import type { PanelProps } from "./MotionPanel";
import { Slider, Toggle, IconButton } from "./Controls";
import { clamp, typingSections, captionsSrt } from "./timeline";
import { download } from "./storage";
const styleKeys = [
  "background",
  "color",
  "padding",
  "radius",
  "shadow",
  "aspect",
  "motionMode",
  "motionIntensity",
  "motionEase",
  "cameraResponse",
  "cameraBounce",
  "followCursor",
  "motionBlur",
  "cursorStyle",
  "cursorSize",
  "cursorHighlight",
  "captionTheme",
  "captionSize",
  "deviceFrame",
  "watermark",
  "watermarkOpacity",
] as const;
const builtins = [
  {
    name: "Clean tutorial",
    color: "#9bad8b",
    value: {
      background: "sage",
      padding: 7,
      radius: 12,
      shadow: 35,
      motionMode: "2d",
      motionEase: "focused",
      motionBlur: 0,
      deviceFrame: "none",
    },
  },
  {
    name: "Cinematic demo",
    color: "#d79777",
    value: {
      background: "dune",
      padding: 13,
      radius: 18,
      shadow: 55,
      motionMode: "3d",
      motionIntensity: 25,
      motionEase: "gentle",
      motionBlur: 45,
      deviceFrame: "none",
    },
  },
  {
    name: "Product launch",
    color: "#a495ba",
    value: {
      background: "bloom",
      padding: 10,
      radius: 16,
      shadow: 50,
      motionMode: "3d",
      motionIntensity: 18,
      motionEase: "smooth",
      motionBlur: 25,
      deviceFrame: "browser",
    },
  },
] as const;
type Preset = { id: string; name: string; settings: Partial<Settings> };
export function StylePresets({ project, edit, notify }: PanelProps) {
  const [name, setName] = useState("My style");
  const [custom, setCustom] = useState<Preset[]>(() => {
    try {
      const items = JSON.parse(localStorage.getItem("studio-presets") || "[]");
      return Array.isArray(items)
        ? items
            .filter(
              (p) =>
                p && typeof p.name === "string" && typeof p.id === "string",
            )
            .map((p) => ({ ...p, settings: cleanSettings(p.settings) }))
        : [];
    } catch {
      return [];
    }
  });
  const file = useRef<HTMLInputElement>(null);
  const remember = (items: Preset[]) => {
    try {
      localStorage.setItem("studio-presets", JSON.stringify(items));
      setCustom(items);
    } catch {
      notify("Style could not be saved: local storage is full.");
    }
  };
  const take = () =>
    Object.fromEntries(
      styleKeys.map((k) => [k, project.settings[k]]),
    ) as Partial<Settings>;
  return (
    <details className="style-presets">
      <summary>
        <WandSparkles size={15} />
        Start with a look<span>3 styles + your presets</span>
      </summary>
      <div className="preset-tiles">
        {builtins.map((p) => (
          <button
            key={p.name}
            onClick={() => {
              edit((v) => ({
                ...v,
                settings: { ...v.settings, ...withCameraFeel(p.value) },
              }));
              notify(`${p.name} applied to canvas and automatic focus.`);
            }}
          >
            <span style={{ background: p.color }}>
              <span />
            </span>
            <strong>{p.name}</strong>
          </button>
        ))}
      </div>
      <div className="preset-save">
        <input
          aria-label="Preset name"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <IconButton
          label="Save current style"
          onClick={() => {
            if (name.trim())
              remember([
                ...custom,
                {
                  id: crypto.randomUUID(),
                  name: name.trim(),
                  settings: take(),
                },
              ]);
          }}
        >
          <Save size={16} />
        </IconButton>
      </div>
      {custom.map((p) => (
        <div className="saved-preset" key={p.id}>
          <button
            onClick={() =>
              edit((v) => ({
                ...v,
                settings: {
                  ...v.settings,
                  ...withCameraFeel(cleanSettings(p.settings)),
                },
              }))
            }
          >
            {p.name}
          </button>
          <IconButton
            label={`Delete preset ${p.name}`}
            onClick={() => remember(custom.filter((v) => v.id !== p.id))}
          >
            <Trash2 size={13} />
          </IconButton>
        </div>
      ))}
      <div className="button-pair">
        <button
          className="button subtle"
          onClick={() =>
            download(
              new Blob(
                [
                  JSON.stringify({
                    format: "studio-style",
                    name,
                    settings: take(),
                  }),
                ],
                { type: "application/json" },
              ),
              `${name || "style"}.studio-style`,
            )
          }
        >
          <ArrowDownToLine size={13} />
          Export style
        </button>
        <button className="button subtle" onClick={() => file.current?.click()}>
          <ArrowUpFromLine size={13} />
          Import
        </button>
      </div>
      <input
        ref={file}
        type="file"
        hidden
        accept=".studio-style"
        onChange={async (e) => {
          try {
            const f = e.target.files?.[0];
            if (!f) return;
            const data = JSON.parse(await f.text());
            if (data.format !== "studio-style" || !data.settings)
              throw new Error("Not a Studio Screen style.");
            const settings: Partial<Settings> = {};
            for (const k of styleKeys) {
              const value = data.settings[k];
              if (typeof value === typeof project.settings[k])
                Object.assign(settings, { [k]: value });
            }
            remember([
              ...custom,
              {
                id: crypto.randomUUID(),
                name: String(data.name || "Imported style").slice(0, 40),
                settings: cleanSettings(settings),
              },
            ]);
            notify("Style imported. Select it to apply.");
          } catch (e) {
            notify((e as Error).message);
          }
        }}
      />
    </details>
  );
}
export function CursorPanel({
  project: p,
  edit,
  notify,
  time,
}: { time: number } & PanelProps) {
  const s = p.settings;
  const set = (value: Partial<Settings>) =>
    edit((p) => ({ ...p, settings: { ...p.settings, ...value } }));
  return (
    <>
      <div className="panel-intro">
        <span className="eyebrow">CURSOR & SHORTCUTS</span>
        <h2>Make every action easy to follow.</h2>
      </div>
      <div className="cursor-style-picker">
        {(["dark", "light", "dot"] as const).map((style) => (
          <button
            key={style}
            className={s.cursorStyle === style ? "selected" : ""}
            onClick={() => set({ cursorStyle: style })}
          >
            {style === "dot" ? (
              <span className="cursor-dot" />
            ) : (
              <MousePointer2
                size={29}
                fill={style === "light" ? "#fff8ec" : "#202420"}
                stroke={style === "light" ? "#202420" : "#fff8ec"}
              />
            )}
            <span>{style}</span>
          </button>
        ))}
      </div>
      <Toggle
        label="Cursor overlay"
        checked={s.showCursor}
        onChange={(showCursor) => set({ showCursor })}
      />
      <Slider
        label="Cursor size"
        value={s.cursorSize}
        min={0.5}
        max={4}
        step={0.1}
        unit="×"
        onChange={(cursorSize) => set({ cursorSize })}
      />
      <Slider
        label="Cursor smoothing"
        value={s.cursorSmoothing}
        min={0}
        max={0.5}
        step={0.01}
        unit=" s"
        onChange={(cursorSmoothing) => set({ cursorSmoothing })}
      />
      <Slider
        label="Cursor angle"
        value={s.cursorAngle}
        min={-90}
        max={90}
        unit="°"
        onChange={(cursorAngle) => set({ cursorAngle })}
      />
      <Toggle
        label="Hide cursor when idle"
        checked={s.cursorIdle}
        onChange={(cursorIdle) => set({ cursorIdle })}
        description="Fade the overlay after 1.5 seconds of inactivity"
      />
      <button
        className="button full-width"
        onClick={() => {
          const start = Math.min(time, p.trimEnd - 0.1);
          edit((p) => ({
            ...p,
            hiddenCursor: [
              ...p.hiddenCursor,
              {
                id: crypto.randomUUID(),
                start,
                end: Math.min(p.trimEnd, start + 3),
              },
            ],
          }));
          notify("Cursor overlay hidden for the next three seconds.");
        }}
      >
        <EyeOff size={14} />
        Hide for 3 seconds here
      </button>
      {p.hiddenCursor.length > 0 && (
        <button
          className="text-button"
          onClick={() => edit((p) => ({ ...p, hiddenCursor: [] }))}
        >
          Clear {p.hiddenCursor.length} hidden ranges
        </button>
      )}
      <div className="section-divider" />
      <Toggle
        label="Click highlights"
        checked={s.cursorHighlight}
        onChange={(cursorHighlight) => set({ cursorHighlight })}
      />
      <label className="select-field">
        <span>Click animation</span>
        <select
          aria-label="Click animation"
          value={s.clickStyle}
          onChange={(e) =>
            set({ clickStyle: e.target.value as Settings["clickStyle"] })
          }
        >
          <option value="ring">Expanding ring</option>
          <option value="pulse">Soft pulse</option>
        </select>
      </label>
      <Slider
        label="Click sound volume"
        value={s.clickVolume}
        max={50}
        unit="%"
        onChange={(clickVolume) => set({ clickVolume })}
      />
      <Toggle
        label="Show keyboard shortcuts"
        checked={s.showShortcuts}
        onChange={(showShortcuts) => set({ showShortcuts })}
        description="Displays captured Ctrl, Alt, and function-key shortcuts"
      />
      <p className="helper-text">
        Effects apply to cursor metadata. An original cursor baked into the
        source cannot be erased. Plain typed text is never stored in shortcut
        metadata.
      </p>
    </>
  );
}
export function CaptionStyle({ project: p, edit, notify }: PanelProps) {
  const s = p.settings;
  const set = (v: Partial<Settings>) =>
    edit((p) => ({ ...p, settings: { ...p.settings, ...v } }));
  return (
    <details className="advanced-controls">
      <summary>Caption appearance & transcript</summary>
      <label className="select-field">
        <span>Style</span>
        <select
          aria-label="Caption style"
          value={s.captionTheme}
          onChange={(e) =>
            set({ captionTheme: e.target.value as Settings["captionTheme"] })
          }
        >
          <option value="classic">Dark pill</option>
          <option value="light">Light pill</option>
          <option value="minimal">Minimal text</option>
        </select>
      </label>
      <Slider
        label="Caption size"
        min={1.5}
        max={6}
        step={0.1}
        value={s.captionSize}
        unit="%"
        onChange={(captionSize) => set({ captionSize })}
      />
      <Slider
        label="Caption position"
        min={10}
        max={96}
        value={s.captionPosition}
        unit="%"
        onChange={(captionPosition) => set({ captionPosition })}
      />
      <button
        className="button full-width"
        onClick={() => {
          download(
            new Blob([captionsSrt(p)], { type: "text/plain" }),
            `${p.name}.srt`,
          );
          notify("SRT downloaded with cuts and speed changes applied.");
        }}
      >
        <ArrowDownToLine size={14} />
        Export edited captions as SRT
      </button>
    </details>
  );
}
export function AudioExtras({ project: p, edit }: PanelProps) {
  const set = (v: Partial<Settings>) =>
    edit((p) => ({ ...p, settings: { ...p.settings, ...v } }));
  return (
    <>
      <div className="section-divider" />
      <h3 className="small-heading">Smooth the beginning and end</h3>
      <Slider
        label="Source fade in / out"
        min={0}
        max={3}
        step={0.1}
        value={p.settings.sourceFade}
        unit=" s"
        onChange={(sourceFade) => set({ sourceFade })}
      />
      <Slider
        label="Music fade in / out"
        min={0}
        max={5}
        step={0.1}
        value={p.settings.musicFade}
        unit=" s"
        onChange={(musicFade) => set({ musicFade })}
      />
      <p className="helper-text">
        Fades follow the final edited video, including cuts and speed sections.
      </p>
    </>
  );
}
export function TimelineEdits({
  project: p,
  edit,
  notify,
  time,
  selected,
  onSelect,
}: {
  time: number;
  selected: string | null;
  onSelect: (id: string) => void;
} & PanelProps) {
  const z = p.speeds.find((s) => s.id === selected);
  return (
    <>
      <div className="panel-intro">
        <span className="eyebrow">PACING & CUTS</span>
        <h2>Keep the good parts moving.</h2>
        <p>
          Speed up a section, skip a pause, or tighten your in and out points.
        </p>
      </div>
      <button
        className="button full-width"
        onClick={() => {
          const id = crypto.randomUUID(),
            start = Math.min(time, p.trimEnd - 0.1);
          edit((p) => ({
            ...p,
            speeds: [
              ...p.speeds,
              { id, start, end: Math.min(p.trimEnd, start + 3), rate: 2 },
            ],
          }));
          onSelect(id);
        }}
      >
        <Plus size={15} />
        Add speed section
      </button>
      <button
        className="button full-width"
        style={{ marginTop: 10 }}
        onClick={() => {
          const groups = typingSections(p);
          if (!groups.length) {
            notify(
              "No typing activity found. Record with the Windows app, or add a speed section manually.",
            );
            return;
          }
          edit((p) => ({ ...p, speeds: [...p.speeds, ...groups] }));
          notify(`Added ${groups.length} sections from typing activity.`);
        }}
      >
        <WandSparkles size={15} />
        Speed up typing to 2×
      </button>
      {z && (
        <section className="selected-edit">
          <div className="section-title">
            <h2>Selected speed section</h2>
            <IconButton
              label="Remove speed section"
              onClick={() =>
                edit((p) => ({
                  ...p,
                  speeds: p.speeds.filter((s) => s.id !== z.id),
                }))
              }
            >
              <Trash2 size={14} />
            </IconButton>
          </div>
          <div className="two-fields">
            <label>
              Start (sec)
              <input
                aria-label="Speed section start"
                type="number"
                step={0.1}
                value={+z.start.toFixed(2)}
                onChange={(e) =>
                  edit((p) => ({
                    ...p,
                    speeds: p.speeds.map((s) =>
                      s.id === z.id
                        ? {
                            ...s,
                            start: clamp(+e.target.value, 0, s.end - 0.1),
                          }
                        : s,
                    ),
                  }))
                }
              />
            </label>
            <label>
              End (sec)
              <input
                aria-label="Speed section end"
                type="number"
                step={0.1}
                value={+z.end.toFixed(2)}
                onChange={(e) =>
                  edit((p) => ({
                    ...p,
                    speeds: p.speeds.map((s) =>
                      s.id === z.id
                        ? {
                            ...s,
                            end: clamp(
                              +e.target.value,
                              s.start + 0.1,
                              p.duration,
                            ),
                          }
                        : s,
                    ),
                  }))
                }
              />
            </label>
          </div>
          <Slider
            label="Section speed"
            min={0.5}
            max={4}
            step={0.25}
            value={z.rate}
            unit="×"
            onChange={(rate) =>
              edit((p) => ({
                ...p,
                speeds: p.speeds.map((s) =>
                  s.id === z.id ? { ...s, rate } : s,
                ),
              }))
            }
          />
        </section>
      )}
      <p className="helper-text">
        Speed sections override the overall playback speed. Overlapping sections
        use the first section; remove or resize it to change the overlap.
      </p>
      <div className="edit-list">
        {p.speeds.map((s) => (
          <button
            key={s.id}
            className={selected === s.id ? "active" : ""}
            onClick={() => onSelect(s.id)}
          >
            <Clock3 size={15} />
            <span>
              {s.rate}× speed
              <small>
                {s.start.toFixed(1)}s – {s.end.toFixed(1)}s
              </small>
            </span>
          </button>
        ))}
      </div>
      {p.cuts.length > 0 && (
        <>
          <div className="section-divider" />
          <h3 className="small-heading">Removed ranges</h3>
          {p.cuts.map((c) => (
            <div className="cut-editor" key={c.id}>
              <span>
                {c.start.toFixed(1)} – {c.end.toFixed(1)} sec
              </span>
              <IconButton
                label="Restore cut"
                onClick={() =>
                  edit((p) => ({
                    ...p,
                    cuts: p.cuts.filter((v) => v.id !== c.id),
                  }))
                }
              >
                <Plus size={14} />
              </IconButton>
            </div>
          ))}
        </>
      )}
    </>
  );
}
