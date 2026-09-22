import TimelineClip, { percent, type Axis } from "./TimelineClip";
import ScreenTrack, { type MenuTarget } from "./ScreenTrack";
import TimelineMenu, { type MenuItem } from "./TimelineMenu";
import {
  closeGap,
  deletePiece,
  dragEdge,
  editPoints,
  pieces,
  restore,
  snapValue,
  sourceFromTimeline,
  splitAt,
  timelineDuration,
  timelineTime,
  type Edge,
} from "./edits";
import { usePreviewSize } from "./usePreviewSize";
import { fadeAt, clickEvents, playClick } from "./sound";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleHelp,
  Clapperboard,
  Copy,
  Download,
  Expand,
  FolderOpen,
  ImagePlus,
  Layers,
  LoaderCircle,
  Magnet,
  Maximize,
  Monitor,
  MousePointer2,
  Move,
  Music2,
  Pause,
  Play,
  Plus,
  Redo2,
  Scissors,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquareSplitHorizontal,
  Subtitles,
  Trash2,
  Type,
  Undo2,
  Upload,
  Volume2,
  WandSparkles,
  X,
  ZoomIn,
} from "lucide-react";
import { backgrounds, defaults, newProject } from "./types";
import RegionPicker from "./RegionPicker";
import Filmstrip from "./Filmstrip";
import { IconButton, Toggle, Slider } from "./Controls";
import MotionPanel from "./MotionPanel";
import {
  CursorPanel,
  StylePresets,
  CaptionStyle,
  AudioExtras,
  TimelineEdits,
} from "./EditorPanels";
import type { DesktopSource, Project, Settings, Zoom } from "./types";
import { aimZoom, focusAt, toPreview, zoomArea, type View } from "./aim";
import {
  autoZooms,
  clamp,
  outputDuration,
  outputTimeAt,
  sourceTime,
  speedAt,
  parseSrt,
  timecode,
} from "./timeline";
import { cardRect, dimensions, renderFrame } from "./compositor";
import { exportProject, type ExportFormat } from "./exporter";
import { nativeCapture } from "./nativeCapture";
import {
  autoEdit,
  backToRaw,
  describeSummary,
  type StopKind,
} from "./autoEdit";
import { lastLook, rememberLook } from "./settings";
import { EditHistory } from "./history";
import { FrameHold, Seeker } from "./previewFrames";
import { installGestures, inputGesture, pointerHeld } from "./gesture";
import { parseEvents } from "./nativeEvents";
import { capture, getDuration, loadVideo, releaseVideo } from "./media";
import {
  deleteProject,
  download,
  listProjects,
  projectFile,
  readProject,
  saveProject,
} from "./storage";

const tabs = [
  { id: "background", label: "Canvas", icon: Layers },
  { id: "zoom", label: "Focus & 3D", icon: ZoomIn },
  { id: "pacing", label: "Pacing", icon: Scissors },
  { id: "cursor", label: "Cursor", icon: MousePointer2 },
  { id: "audio", label: "Audio", icon: AudioLines },
  { id: "captions", label: "Captions", icon: Subtitles },
  { id: "annotations", label: "Annotate", icon: Type },
];
const uid = () => crypto.randomUUID();
/** No zooms, one array forever, so the flat view's camera path stays cached. */
const NO_ZOOMS: Zoom[] = [];
/** Aim view: the whole recording, unzoomed, untilted and uncropped. */
const flatView = (p: Project): Project => ({
  ...p,
  zooms: NO_ZOOMS,
  settings: { ...p.settings, autoZoom: false, crop: 0 },
});
/** The timeline's collapsed axis for a project (ripple cuts take no width). */
const axisFor = (p: Project): Axis => ({
  total: Math.max(1e-6, timelineDuration(p)),
  duration: p.duration,
  tl: (t) => timelineTime(p, t),
  src: (x) => sourceFromTimeline(p, x),
});
/** The folder a saved file is in, by name ("Exports"). */
const folderName = (file: string) =>
  file.split(/[\\/]/).slice(-2, -1)[0] || file;
function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, textarea, [tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
export default function App() {
  const [project, setProject] = useState<Project>(() => newProject());
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState("Saving…");
  const [tab, setTab] = useState("background");
  const [backgroundTab, setBackgroundTab] = useState("Gradient");
  const [time, setTime] = useState(2);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<
    "record" | "export" | "library" | "help" | null
  >(null);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [source, setSource] = useState("");
  const [regionEnabled, setRegionEnabled] = useState(false);
  const [region, setRegion] = useState({
    x: 0.1,
    y: 0.1,
    width: 0.8,
    height: 0.8,
  });
  const [systemAudio, setSystemAudio] = useState(true);
  const [recordFps, setRecordFps] = useState(60);
  const [recording, setRecording] = useState(false);
  const [recordPaused, setRecordPaused] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const [countdown, setCountdown] = useState(() => {
    try {
      return localStorage.getItem("studio-countdown") !== "off";
    } catch {
      return true;
    }
  });
  const discardRef = useRef(false);
  const runExportRef = useRef<(quick?: boolean) => Promise<void>>(
    async () => {},
  );
  // How the take ended, and where the bar was: the auto-edit trims that reach.
  const stopRef = useRef<{
    kind: StopKind;
    bar?: { x: number; y: number; width: number; height: number };
  }>({ kind: "other" });
  const [toastAction, setToastAction] = useState<{
    label: string;
    run: () => void;
  } | null>(null);
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  // Export settings are remembered so the next export is one keypress (Ctrl+E).
  const savedExport = (() => {
    try {
      return JSON.parse(localStorage.getItem("studio-export") || "{}");
    } catch {
      return {};
    }
  })();
  const [exportFormat, setExportFormat] = useState<ExportFormat>(() =>
    ["mp4", "webm", "gif"].includes(savedExport.format)
      ? savedExport.format
      : "mp4",
  );
  const [exportHeight, setExportHeight] = useState<number>(() =>
    [720, 1080, 2160].includes(savedExport.height) ? savedExport.height : 1080,
  );
  const [exportFps, setExportFps] = useState<number>(() =>
    [30, 60].includes(savedExport.fps) ? savedExport.fps : 60,
  );
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [exportDone, setExportDone] = useState(false);
  const [exportSpeed, setExportSpeed] = useState(0);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [mediaVersion, setMediaVersion] = useState(0);
  const [timelineScale, setTimelineScale] = useState(1);
  // Timeline height dragged by hand; null is the resting height from CSS.
  const [timelineHeight, setTimelineHeight] = useState<number | null>(() => {
    try {
      const saved = Number(localStorage.getItem("studio-timeline-height"));
      return saved > 0 ? saved : null;
    } catch {
      return null;
    }
  });
  const timelineRef = useRef<HTMLElement>(null);
  const timelineDrag = useRef<{ y: number; height: number } | null>(null);
  // Premiere-style timeline tools: V selects, C is the razor, S toggles snapping.
  const [tool, setTool] = useState<"select" | "razor">("select");
  const [snapOn, setSnapOn] = useState(() => {
    try {
      return localStorage.getItem("studio-snap") !== "off";
    } catch {
      return true;
    }
  });
  /** The project as drawn while an edit point is being dragged. */
  const [draft, setDraft] = useState<Project | null>(null);
  /** Timeline position (seconds) of the snap line, while something is snapped. */
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    target: MenuTarget;
  } | null>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  // Focus dot and aim view: pressing the dot shows the flat frame with the
  // zoom's area and every other zoom's focus as a ghost; release commits.
  const [aim, setAim] = useState<{
    id: string;
    key: number;
    x: number;
    y: number;
  } | null>(null);
  const aimDrag = useRef<{
    clientX: number;
    clientY: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const tiltDrag = useRef<{
    id: string;
    pointer: number;
    clientX: number;
    clientY: number;
    tiltX: number;
    tiltY: number;
    tiltZ: number;
  } | null>(null);
  const tiltHint = useRef(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  // The paused preview holds its last good picture while seeks land, and
  // coalesces scrub seeks instead of restarting one per pointer move.
  const hold = useRef(new FrameHold());
  const seeker = useRef<Seeker | null>(null);
  const music = useRef<HTMLVideoElement | null>(null);
  const background = useRef<HTMLImageElement | null>(null);
  const captureRef = useRef<{
    stop: () => void;
    pause: () => void;
    resume: () => void;
    elapsed: () => number;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null),
    imageInput = useRef<HTMLInputElement>(null),
    audioInput = useRef<HTMLInputElement>(null),
    captionInput = useRef<HTMLInputElement>(null);
  const history = useRef(new EditHistory<Project>());
  const stateRef = useRef(project);
  stateRef.current = project;
  // The live playhead. While playing, the animation loop owns it and draws
  // every frame itself; `time` state catches up when playback stops. Every
  // jump elsewhere goes through seekTo so the two never disagree.
  const tRef = useRef(time);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const playheadRef = useRef<HTMLDivElement>(null);
  const timeTextRef = useRef<HTMLOutputElement>(null);
  const currentTime = useCallback(() => tRef.current, []);
  const seekTo = useCallback((t: number) => {
    tRef.current = t;
    setTime(t);
  }, []);
  const s = project.settings;
  const previewSize = usePreviewSize(canvas, s.aspect);
  const aiming = aim !== null;
  const duration = outputDuration(project);
  const notify = useCallback((value: string) => {
    setToastAction(null);
    setToast(value);
  }, []);
  const notifyAction = useCallback(
    (value: string, label: string, run: () => void) => {
      setToast(value);
      setToastAction({ label, run });
    },
    [],
  );
  useEffect(() => installGestures(), []);
  /**
   * Apply an edit as an undo step. Edits from one continuous gesture (a slider
   * drag, typing a number) merge into one step: pass `gesture` for pointer
   * drags on custom controls; inputs are recognised automatically.
   */
  const edit = useCallback(
    (fn: (p: Project) => Project, options: { gesture?: string } = {}) => {
      const previous = stateRef.current;
      const next = fn(previous);
      if (next === previous) return;
      history.current.record(previous, {
        gesture: options.gesture ?? inputGesture(),
        held: pointerHeld(),
      });
      stateRef.current = next;
      setProject(next);
    },
    [],
  );
  const setting = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    edit((p) => ({ ...p, settings: { ...p.settings, [key]: value } }));
  /** Change one zoom; editing an automatic zoom takes ownership of it. */
  const editZoom = useCallback(
    (id: string, change: (z: Zoom) => Zoom, gesture?: string) =>
      edit(
        (p) => {
          const owned = p.zooms.find((v) => v.id === id);
          const base = owned ?? autoZooms(p).find((v) => v.id === id);
          if (!base) return p;
          const next = change(base);
          return {
            ...p,
            zooms: owned
              ? p.zooms.map((v) => (v.id === id ? next : v))
              : [...p.zooms, next],
          };
        },
        { gesture },
      ),
    [edit],
  );
  // Wheel over the focus dot (or in aim view) changes magnification; Alt+wheel
  // changes a 3D zoom's field of view. Native listener: it must cancel scrolling.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const wheel = (e: WheelEvent) => wheelRef.current(e);
    frame.addEventListener("wheel", wheel, { passive: false });
    return () => frame.removeEventListener("wheel", wheel);
  }, []);
  const undo = useCallback(() => {
    const previous = history.current.undo(stateRef.current);
    if (previous) {
      stateRef.current = previous;
      setProject(previous);
    }
  }, []);
  const redo = useCallback(() => {
    const next = history.current.redo(stateRef.current);
    if (next) {
      stateRef.current = next;
      setProject(next);
    }
  }, []);
  const closeModal = useCallback(() => {
    if (abortRef.current) return;
    setModal(null);
  }, []);
  const openProject = (p: Project) => {
    setPlaying(false);
    history.current.clear();
    setSelected(null);
    setProject(p);
    seekTo(p.trimStart);
    setModal(null);
  };
  useEffect(() => {
    let alive = true;
    listProjects()
      .then((items) => {
        if (!alive) return;
        const latest = items.sort((a, b) => b.updated - a.updated)[0];
        if (latest) {
          setProject(latest);
          seekTo(latest.trimStart);
        }
        return recover(items);
      })
      .catch(() =>
        notify(
          "Local storage is unavailable. Download your project to keep a copy.",
        ),
      )
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [notify]);
  useEffect(() => {
    if (!ready) return;
    setSaved("Saving…");
    const timer = setTimeout(() => {
      // Native recordings also keep their edit next to the footage on disk.
      if (project.folder && window.studioDesktop)
        void window.studioDesktop.native.saveProject(
          project.folder,
          JSON.stringify({ ...project, format: "studio-screen", version: 2 }),
        );
      saveProject(project)
        .then(() => setSaved("Saved locally"))
        .catch(() => {
          setSaved("Not saved");
          notify(
            "Your browser storage is full or unavailable. Download the project to keep your work.",
          );
        });
    }, 700);
    return () => clearTimeout(timer);
  }, [project, ready, notify]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(
      () => {
        setToast("");
        setToastAction(null);
      },
      toastAction ? 14000 : 6000,
    );
    return () => clearTimeout(timer);
  }, [toast, toastAction]);
  useEffect(() => {
    try {
      localStorage.setItem(
        "studio-export",
        JSON.stringify({
          format: exportFormat,
          height: exportHeight,
          fps: exportFps,
        }),
      );
    } catch {}
  }, [exportFormat, exportHeight, exportFps]);
  // New recordings start with the look of the last project edited.
  useEffect(() => {
    if (ready && !project.demo) rememberLook(project.settings);
  }, [ready, project.demo, project.settings]);
  useEffect(() => {
    let alive = true;
    let loaded: HTMLVideoElement | null = null;
    setPlaying(false);
    video.current = null;
    const media = project.video || project.videoUrl;
    if (media)
      loadVideo(media)
        .then((v) => {
          loaded = v;
          if (!alive) return releaseVideo(v);
          video.current = v;
          seeker.current = new Seeker(v, () => setMediaVersion((n) => n + 1));
          seeker.current.seek(tRef.current);
          setMediaVersion((n) => n + 1);
        })
        .catch((e) => notify(e.message));
    return () => {
      alive = false;
      releaseVideo(loaded);
      if (video.current === loaded) {
        video.current = null;
        seeker.current = null;
      }
    };
  }, [project.video, project.videoUrl, notify]);
  useEffect(() => {
    let alive = true;
    let loaded: HTMLVideoElement | null = null;
    music.current = null;
    if (project.music)
      loadVideo(project.music)
        .then((v) => {
          loaded = v;
          if (!alive) return releaseVideo(v);
          v.loop = true;
          music.current = v;
        })
        .catch((e) => notify(e.message));
    return () => {
      alive = false;
      releaseVideo(loaded);
    };
  }, [project.music, notify]);
  useEffect(() => {
    background.current = null;
    if (!project.backgroundImage) return;
    const img = new Image();
    const url = URL.createObjectURL(project.backgroundImage);
    img.src = url;
    img.onload = () => {
      background.current = img;
      setMediaVersion((n) => n + 1);
    };
    return () => {
      img.onload = null;
      URL.revokeObjectURL(url);
    };
  }, [project.backgroundImage]);
  useEffect(() => {
    if (!canvas.current) return;
    if (
      canvas.current.width !== previewSize.width ||
      canvas.current.height !== previewSize.height
    )
      Object.assign(canvas.current, previewSize);
    if (playingRef.current) return;
    try {
      renderFrame(canvas.current, aiming ? flatView(project) : project, time, {
        ...hold.current.media(video.current),
        background: background.current,
      });
    } catch (e) {
      setPlaying(false);
      notify(
        (e as Error).message + " Choose Classic zoom if 3D is unavailable.",
      );
    }
  }, [project, time, mediaVersion, s.aspect, previewSize, notify, aiming]);
  useEffect(() => {
    if (!playing) seeker.current?.seek(time);
  }, [time, playing, mediaVersion]);
  useLayoutEffect(() => {
    if (playing) return;
    if (timeTextRef.current)
      timeTextRef.current.textContent = timecode(outputTimeAt(project, time));
    if (playheadRef.current)
      playheadRef.current.style.left = `${percent(axisFor(draft ?? project), time)}%`;
  }, [playing, project, draft, time]);
  useEffect(() => {
    if (!playing) {
      video.current?.pause();
      music.current?.pause();
      return;
    }
    if (tRef.current >= stateRef.current.trimEnd - 0.05)
      tRef.current = stateRef.current.trimStart;
    const sound =
      stateRef.current.settings.clickVolume > 0 ? new AudioContext() : null;
    if (sound) void sound.resume();
    let lastOutput = outputTimeAt(stateRef.current, tRef.current);
    let frame = 0,
      last = performance.now();
    const draw = (p: Project, t: number) => {
      if (!canvas.current) return;
      try {
        renderFrame(canvas.current, p, t, {
          ...hold.current.media(video.current, false),
          background: background.current,
        });
      } catch (e) {
        setPlaying(false);
        notify(
          (e as Error).message + " Choose Classic zoom if 3D is unavailable.",
        );
      }
    };
    const tick = (now: number) => {
      const p = stateRef.current;
      const v = video.current;
      let next: number;
      if (!v) {
        // The procedural sample has no media clock; follow the wall clock.
        next = sourceTime(
          p,
          outputTimeAt(p, tRef.current) + (now - last) / 1000,
        );
      } else if (!v.paused && !v.seeking && v.readyState >= 2) {
        // Follow the video's own clock so the drawn cursor and camera stay
        // locked to the footage underneath them.
        next = v.currentTime;
      } else next = tRef.current;
      last = now;
      if (v) v.playbackRate = speedAt(p, next);
      const out = outputTimeAt(p, next),
        total = outputDuration(p);
      if (v)
        v.volume =
          (p.settings.volume / 100) * fadeAt(out, total, p.settings.sourceFade);
      if (music.current)
        music.current.volume =
          (p.settings.musicVolume / 100) *
          fadeAt(out, total, p.settings.musicFade);
      if (sound)
        for (const click of clickEvents(p))
          if (click >= lastOutput && click < out)
            playClick(sound, sound.destination, p.settings.clickVolume);
      lastOutput = out;
      for (const cut of [...p.cuts].sort((a, b) => a.start - b.start))
        if (next >= cut.start && next < cut.end) next = cut.end;
      if (next < p.trimStart) next = p.trimStart;
      if (next >= p.trimEnd || (v?.ended ?? false)) {
        tRef.current = p.trimEnd;
        draw(p, p.trimEnd);
        setPlaying(false);
        return;
      }
      if (v && !v.seeking && Math.abs(v.currentTime - next) > 0.2) {
        hold.current.capture(v);
        v.currentTime = next;
      }
      tRef.current = next;
      draw(p, next);
      if (timeTextRef.current) timeTextRef.current.textContent = timecode(out);
      if (playheadRef.current)
        playheadRef.current.style.left = `${percent(axisFor(p), next)}%`;
      frame = requestAnimationFrame(tick);
    };
    const v = video.current;
    if (v) {
      seeker.current?.cancel();
      hold.current.capture(v);
      v.currentTime = tRef.current;
      v.playbackRate = speedAt(stateRef.current, tRef.current);
      v.volume = s.volume / 100;
      void v.play().catch(() => setPlaying(false));
    }
    if (music.current) {
      music.current.currentTime =
        outputTimeAt(stateRef.current, tRef.current) % music.current.duration;
      music.current.volume = s.musicVolume / 100;
      void music.current.play().catch(() => {});
    }
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      void sound?.close();
      // Hand the loop's position back to React so the paused frame matches.
      setTime(tRef.current);
    };
  }, [playing, s.speed, s.volume, s.musicVolume, notify]);
  /**
   * Delete: a piece leaves a gap (Shift: ripple), a gap closes up, anything
   * else on the timeline is removed.
   */
  const removeSelected = useCallback(
    (ripple = false) => {
      if (!selected) return;
      const p = stateRef.current;
      const piece = pieces(p).find((x) => x.id === selected);
      if (piece) {
        const next = deletePiece(p, piece, { ripple });
        if (next === p) {
          notify("Keep at least a little footage in your project.");
          return;
        }
        edit(() => next);
        setSelected(null);
        return;
      }
      const cut = p.cuts.find((c) => c.id === selected);
      if (cut) {
        if (!cut.ripple) edit((v) => closeGap(v, cut.id));
        setSelected(null);
        return;
      }
      if (ripple) return;
      edit((p) => ({
        ...p,
        zooms: p.zooms.filter((z) => z.id !== selected),
        dismissedZooms: selected.startsWith("auto-")
          ? [...p.dismissedZooms, selected]
          : p.dismissedZooms,
        captions: p.captions.filter((c) => c.id !== selected),
        annotations: p.annotations.filter((a) => a.id !== selected),
        speeds: p.speeds.filter((c) => c.id !== selected),
      }));
      setSelected(null);
    },
    [selected, edit, notify],
  );
  /** Split the footage at a source time (the playhead unless given). */
  const splitHere = useCallback(
    (t: number, quiet = false) => {
      const p = stateRef.current;
      const next = splitAt(p, t);
      if (next !== p) edit(() => next);
      else if (!quiet)
        notify(
          "Move the playhead onto the footage, away from an existing edit, to split there.",
        );
    },
    [edit, notify],
  );
  const toggleSnap = useCallback(() => {
    setSnapOn((on) => {
      try {
        localStorage.setItem("studio-snap", on ? "off" : "on");
      } catch {}
      return !on;
    });
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // Esc lets go of the selection unless a text field or menu wants it.
      if (
        e.key === "Escape" &&
        !modal &&
        !recording &&
        !(e.target as HTMLElement).closest(
          'textarea,select,[contenteditable="true"],input:not([type="range"]):not([type="color"])',
        )
      ) {
        setSelected(null);
        setTool("select");
        return;
      }
      // Undo and redo also work right after dragging a slider, while it still
      // has focus; text fields keep their own typing undo.
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "z" &&
        !modal &&
        !recording &&
        !(e.target as HTMLElement).closest(
          'textarea,[contenteditable="true"],input:not([type="range"]):not([type="color"])',
        )
      ) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,select,[contenteditable="true"]',
        ) ||
        modal ||
        recording
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((v) => !v);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
        // Quick export with the last settings, next to the last export.
        e.preventDefault();
        setModal("export");
        void runExportRef.current(true);
      }
      // Premiere keys: Ctrl+K splits at the playhead, C razor, V select, S snap.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        splitHere(tRef.current);
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const letter = e.key.toLowerCase();
        if (letter === "c") setTool("razor");
        if (letter === "v") setTool("select");
        if (letter === "s") toggleSnap();
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setPlaying(false);
        seekTo(
          clamp(
            tRef.current +
              (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 1 : 1 / 30),
            project.trimStart,
            project.trimEnd,
          ),
        );
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeSelected(e.shiftKey);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [
    modal,
    recording,
    redo,
    undo,
    project.trimStart,
    project.trimEnd,
    removeSelected,
    splitHere,
    toggleSnap,
  ]);
  useEffect(
    () =>
      window.studioDesktop?.onStop(() => {
        if (!captureRef.current) return;
        stopRef.current = { kind: "hotkey" };
        captureRef.current.stop();
      }),
    [],
  );
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const elapsed = captureRef.current?.elapsed() || 0;
      setRecordTime(elapsed);
      void window.studioDesktop?.recordingUi({
        phase: "status",
        elapsed,
        paused: recordPaused,
      });
    }, 200);
    return () => clearInterval(timer);
  }, [recording, recordPaused]);
  useEffect(
    () =>
      window.studioDesktop?.onCommand((command, bar) => {
        const control = captureRef.current;
        if (!control) return;
        if (command === "pause") {
          control.pause();
          setRecordPaused(true);
        } else if (command === "resume") {
          control.resume();
          setRecordPaused(false);
        } else {
          discardRef.current = command === "discard";
          stopRef.current = { kind: "bar", bar };
          control.stop();
        }
      }),
    [],
  );
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (recording || exportProgress !== null || saved !== "Saved locally") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [recording, exportProgress, saved]);
  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setPlaying(false);
    try {
      if (file.name.endsWith(".studio")) {
        openProject(await readProject(file));
        notify("Project opened. All edits and media restored.");
      } else {
        const v = await loadVideo(file);
        let d: number;
        try {
          d = await getDuration(v);
        } finally {
          releaseVideo(v);
        }
        if (!d || !Number.isFinite(d))
          throw new Error("Could not read the video duration.");
        const p = newProject(false);
        p.name = file.name.replace(/\.[^.]+$/, "");
        p.video = file;
        p.duration = d;
        p.trimEnd = d;
        openProject(p);
        notify("Video imported. Add a zoom to choose your focus points.");
      }
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function openRecord() {
    setPlaying(false);
    setModal("record");
    if (window.studioDesktop) {
      try {
        const items = await window.studioDesktop.sources();
        setSources(items);
        setSource(items[0]?.id || "");
      } catch (e) {
        notify((e as Error).message);
      }
    }
  }
  /** Build a project from a recording folder the app never opened (crash or close). */
  async function recover(existing: Project[]) {
    const desktop = window.studioDesktop;
    if (!desktop) return;
    const found = (await desktop.native.recoveries()).filter(
      (r) => !existing.some((p) => p.folder === r.folder),
    );
    let opened: Project | undefined;
    for (const item of found) {
      try {
        const v = await loadVideo(item.videoUrl);
        let duration: number;
        try {
          duration = await getDuration(v);
        } finally {
          releaseVideo(v);
        }
        const { points, activity } = parseEvents(
          await desktop.native.events(item.folder),
        );
        const p = newProject(false);
        p.name = `Recovered · ${item.name}`;
        p.capture = "native";
        p.folder = item.folder;
        p.videoUrl = item.videoUrl;
        p.duration = duration;
        p.trimEnd = duration;
        p.points = points;
        p.activity = activity;
        await saveProject(p);
        await desktop.native.recovered(item.folder);
        opened = p;
      } catch {
        // Unreadable leftovers stay on disk untouched.
      }
    }
    if (opened) {
      openProject(opened);
      notify("Recovered a recording that didn't finish. It's open and saved.");
    }
  }
  async function startRecord() {
    const desktop = window.studioDesktop;
    let barShown = false;
    setBusy(true);
    discardRef.current = false;
    stopRef.current = { kind: "other" };
    // Desktop: get out of the way and count in before the first recorded frame.
    const beforeStart = desktop
      ? async () => {
          barShown = true;
          setModal(null);
          await desktop.recordingUi({
            phase: "countdown",
            seconds: countdown ? 3 : 0,
          });
        }
      : undefined;
    try {
      if (desktop) {
        if (!source) throw new Error("Choose a screen or window first.");
        await desktop.selectSource(source);
      }
      const native = !!desktop && (await desktop.native.available());
      if (!native && !navigator.mediaDevices?.getDisplayMedia)
        throw new Error(
          "Screen capture needs the desktop app or Chrome/Edge on localhost or HTTPS.",
        );
      const options = {
        system: systemAudio,
        fps: recordFps,
        region: regionEnabled ? region : undefined,
        beforeStart,
      };
      let finished: Promise<{
        duration: number;
        points: Project["points"];
        hasSystemAudio: boolean;
        apply: (p: Project) => void;
        reason?: string;
      }>;
      if (native) {
        const control = await nativeCapture(options);
        captureRef.current = control;
        finished = control.done.then((r) => ({
          ...r,
          apply: (p) => {
            p.capture = "native";
            p.folder = r.folder;
            p.videoUrl = r.videoUrl;
            p.activity = r.activity;
          },
        }));
      } else {
        const control = await capture(options);
        captureRef.current = control;
        if (desktop)
          notify(
            "Using browser capture: the Windows cursor will be baked into this recording.",
          );
        finished = control.done.then((r) => {
          if (!r.video.size)
            throw new Error(
              "The recording was too short. Record for at least a second.",
            );
          return {
            ...r,
            apply: (p) => {
              p.capture = "legacy";
              p.video = r.video;
              p.settings.showCursor = false;
            },
          };
        });
      }
      setModal(null);
      setRecording(true);
      setRecordPaused(false);
      setRecordTime(0);
      setBusy(false);
      if (desktop) void desktop.recordingUi({ phase: "recording", notes });
      const result = await finished;
      setRecording(false);
      captureRef.current = null;
      if (discardRef.current) {
        notify("Take discarded. Ready when you are.");
        return;
      }
      if (result.duration < 0.2)
        throw new Error(
          "The recording was too short. Record for at least a second.",
        );
      const p = newProject(false);
      p.name = `Recording · ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
      p.settings = { ...p.settings, ...lastLook() };
      result.apply(p);
      p.duration = result.duration;
      p.trimEnd = result.duration;
      p.points = result.points;
      // The rough cut: trim, speed up typing and waiting, zoom to clicks.
      const stop = stopRef.current;
      const bar =
        stop.bar && regionEnabled
          ? {
              x: (stop.bar.x - region.x) / region.width,
              y: (stop.bar.y - region.y) / region.height,
              width: stop.bar.width / region.width,
              height: stop.bar.height / region.height,
            }
          : stop.bar;
      const { project: edited, summary } = autoEdit(p, {
        stop:
          result.reason && result.reason !== "stopped" ? "other" : stop.kind,
        bar,
      });
      openProject(edited);
      const note =
        result.reason === "window-closed"
          ? "The window you were recording closed, so the take ended there. "
          : result.reason === "interrupted"
            ? "Recording stopped unexpectedly; everything up to that moment is kept. "
            : systemAudio && !result.hasSystemAudio
              ? "The selected source did not provide system audio. "
              : "";
      if (summary.applied)
        notifyAction(
          `${note}Auto-edit: ${describeSummary(summary)}.`,
          "Back to raw",
          () => edit(backToRaw),
        );
      else notify(`${note}Recording ready. Make it your own.`);
    } catch (e) {
      setRecording(false);
      captureRef.current = null;
      notify(
        (e as Error).name === "NotAllowedError"
          ? "Capture cancelled or permission denied. You can try again or import a video."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
      if (desktop && barShown) void desktop.recordingUi({ phase: "idle" });
    }
  }
  function addZoom(mode: "2d" | "3d" = "2d") {
    const start = clamp(tRef.current, project.trimStart, project.trimEnd - 0.3);
    const id = uid();
    edit((p) => ({
      ...p,
      zooms: [
        ...p.zooms,
        {
          id,
          start,
          end: Math.min(start + 3, p.trimEnd),
          x: 0.5,
          y: 0.5,
          scale: mode === "3d" ? 1.35 : 1.8,
          mode,
          follow: false,
          tiltX: -10,
          tiltY: 18,
          tiltZ: -2,
        },
      ],
    }));
    setSelected(id);
    setTab("zoom");
    seekTo(Math.min(start + 1, project.trimEnd - 0.1));
    notify(
      mode === "3d"
        ? "3D focus added. Choose an angle in the inspector."
        : "Zoom added. Adjust its focus point in the inspector.",
    );
  }
  runExportRef.current = runExport;
  /** `quick` (Ctrl+E) saves next to the last export without asking where. */
  async function runExport(quick = false) {
    if (abortRef.current) return;
    setPlaying(false);
    setExportDone(false);
    setExportedPath(null);
    setExportSpeed(0);
    const controller = new AbortController();
    abortRef.current = controller;
    const desktop = window.studioDesktop;
    const format = exportFormat;
    const name =
      project.name.replace(/[^a-z0-9 -]/gi, "").trim() || "Cool Story";
    let file: { id: string; path: string } | null = null;
    let kept = false;
    let lastReport = 0;
    try {
      // The desktop app asks where to save (Save As), then streams the file
      // straight to disk as it renders.
      if (desktop) {
        file = await desktop.exportFile.open(name, format, { quick });
        // Save As was cancelled: stay in the export dialog, ready to try again.
        if (!file) return;
      }
      setExportProgress(0);
      const blob = await exportProject(project, {
        format,
        height: format === "gif" ? Math.min(exportHeight, 480) : exportHeight,
        fps: format === "gif" ? Math.min(exportFps, 15) : exportFps,
        signal: controller.signal,
        progress: (share, info) => {
          const now = performance.now();
          if (now - lastReport < 100 && share < 1) return;
          lastReport = now;
          setExportProgress(share);
          setExportSpeed(info.speed);
        },
        writer: file
          ? {
              write: (position, data) =>
                desktop!.exportFile.write(file!.id, position, data),
            }
          : undefined,
      });
      if (file) {
        await desktop!.exportFile.close(file.id, true);
        kept = true;
        setExportedPath(file.path);
        notify(`Export complete. Saved to ${folderName(file.path)}.`);
      } else if (blob) {
        download(blob, `${name}.${format}`);
        notify("Export complete. Your file is ready in downloads.");
      }
      setExportDone(true);
    } catch (e) {
      notify(
        (e as Error).name === "AbortError"
          ? "Export cancelled. Your project is unchanged."
          : (e as Error).message,
      );
    } finally {
      if (file && !kept)
        await desktop!.exportFile.close(file.id, false).catch(() => {});
      abortRef.current = null;
      setExportProgress(null);
      setMediaVersion((n) => n + 1);
    }
  }
  /** Set the timeline height within its resting height and 70% of the editor. */
  const sizeTimeline = (height: number | null, remember = false) => {
    const section = timelineRef.current,
      editor = section?.parentElement;
    let next: number | null = null;
    if (section && editor && height !== null) {
      const base =
        parseFloat(
          getComputedStyle(section).getPropertyValue("--timeline-default"),
        ) || 278;
      next = Math.round(
        clamp(height, base, Math.max(base, editor.clientHeight * 0.7)),
      );
      if (next <= base) next = null;
    }
    setTimelineHeight(next);
    if (remember)
      try {
        if (next === null) localStorage.removeItem("studio-timeline-height");
        else localStorage.setItem("studio-timeline-height", String(next));
      } catch {}
  };
  const chosenAnnotation = project.annotations.find((a) => a.id === selected),
    chosenCut = project.cuts.find((c) => c.id === selected);
  /**
   * Snap a timeline position (seconds) to nearby edit points within 8 CSS px:
   * the playhead, piece, split and gap boundaries, trim ends, and the starts
   * and ends of other clips.
   */
  const snapX = (x: number, exclude?: string, withPlayhead = true) => {
    const tracks = tracksRef.current;
    if (!snapOn || !tracks) return x;
    const p = stateRef.current,
      a = axisFor(p);
    const edges = (items: { id: string; start: number; end: number }[]) =>
      items.filter((v) => v.id !== exclude).flatMap((v) => [v.start, v.end]);
    const targets = [
      ...(withPlayhead ? [tRef.current] : []),
      ...editPoints(p),
      ...edges(autoZooms(p)),
      ...edges(p.captions),
      ...edges(p.annotations),
      ...edges(p.speeds),
    ].map(a.tl);
    return snapValue(
      x,
      targets,
      (8 / tracks.getBoundingClientRect().width) * a.total,
    );
  };
  const scrubTo = (clientX: number) => {
    const tracks = tracksRef.current;
    if (!tracks) return;
    const p = stateRef.current,
      a = axisFor(p);
    const rect = tracks.getBoundingClientRect();
    const raw = clamp(((clientX - rect.left) / rect.width) * a.total, 0, a.total);
    const x = snapX(raw, undefined, false);
    setSnapLine(x !== raw ? x : null);
    setPlaying(false);
    seekTo(clamp(a.src(x), p.trimStart, p.trimEnd));
  };
  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.type === "pointerdown") {
      // Clips, gaps and buttons stop their own presses, so this is empty space.
      setSelected(null);
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    scrubTo(e.clientX);
  };
  /** A press on a piece of footage selects it and scrubs from there. */
  const scrubFromPiece = (e: React.PointerEvent) => {
    tracksRef.current?.setPointerCapture(e.pointerId);
    scrubTo(e.clientX);
  };
  /** Drag an edit point (trim grip, split or gap edge); one undo step on release. */
  const startEdgeDrag = (e: React.PointerEvent, edge: Edge, at: number) => {
    e.stopPropagation();
    if (e.button !== 0 || !tracksRef.current) return;
    e.preventDefault();
    const base = stateRef.current,
      a = axisFor(base),
      width = tracksRef.current.getBoundingClientRect().width,
      x0 = e.clientX,
      from = a.tl(at),
      id = uid();
    let result = base;
    const move = (ev: PointerEvent) => {
      const raw = from + ((ev.clientX - x0) / width) * a.total;
      const x = snapX(raw);
      setSnapLine(x !== raw ? x : null);
      result = dragEdge(base, edge, a.src(x), ev.shiftKey, id);
      setDraft(result === base ? null : result);
    };
    const finish = (commit: boolean) => () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", cancel);
      setDraft(null);
      setSnapLine(null);
      if (commit && result !== base) edit(() => result);
    };
    const done = finish(true),
      cancel = finish(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", cancel);
  };
  const openMenu = (e: React.MouseEvent, target: MenuTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected(target.kind === "piece" ? target.piece.id : target.id);
    setMenu({ x: e.clientX, y: e.clientY, target });
  };
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuItems = (target: MenuTarget): MenuItem[] => {
    const change = (fn: (p: Project) => Project) => {
      const p = stateRef.current,
        next = fn(p);
      if (next === p) notify("Keep at least a little footage in your project.");
      else edit(() => next);
      setSelected(null);
    };
    if (target.kind === "piece") {
      const { piece } = target;
      return [
        {
          label: "Split at playhead",
          hint: "Ctrl+K",
          disabled: !(tRef.current > piece.start && tRef.current < piece.end),
          run: () => splitHere(tRef.current),
        },
        {
          label: "Delete (leave gap)",
          hint: "Delete",
          run: () => change((p) => deletePiece(p, piece, { ripple: false })),
        },
        {
          label: "Ripple delete",
          hint: "Shift+Delete",
          run: () => change((p) => deletePiece(p, piece, { ripple: true })),
        },
      ];
    }
    const restoreItem = {
      label: "Restore footage",
      run: () => change((p) => restore(p, target.id)),
    };
    if (target.kind === "ripple") return [restoreItem];
    return [
      {
        label: "Close gap",
        hint: "Delete",
        run: () => change((p) => closeGap(p, target.id)),
      },
      restoreItem,
    ];
  };
  const selectedZoom = autoZooms(project).find((z) => z.id === selected);
  const is3dZoom = (z: Zoom) => (z.mode || s.motionMode) === "3d";
  const view: View = {
    width: previewSize.width,
    height: previewSize.height,
    card: cardRect(previewSize.width, previewSize.height, project, {
      video: video.current,
    }),
  };
  const percentOf = (pt: { x: number; y: number }) => ({
    left: `${(pt.x / view.width) * 100}%`,
    top: `${(pt.y / view.height) * 100}%`,
  });
  const focusDot =
    selectedZoom && !playing
      ? (() => {
          const aimed = aim?.id === selectedZoom.id ? aim : null;
          const f = aimed ?? focusAt(selectedZoom, time);
          return {
            f,
            key: aimed ? aimed.key : focusAt(selectedZoom, time).key,
            at: toPreview(project, time, f.x, f.y, view, !!aimed),
          };
        })()
      : null;
  wheelRef.current = (e) => {
    const z = selectedZoom;
    const notch = Math.sign(-e.deltaY);
    if (!z || playingRef.current || !notch) return;
    if (e.altKey) {
      if (!is3dZoom(z)) return;
      e.preventDefault();
      editZoom(
        z.id,
        (v) => ({
          ...v,
          perspective: clamp((v.perspective || 45) + 2 * notch, 25, 75),
        }),
        `fov:${z.id}`,
      );
      return;
    }
    if (!aim && !(e.target as HTMLElement).closest(".focus-dot")) return;
    e.preventDefault();
    editZoom(
      z.id,
      (v) => ({
        ...v,
        scale: clamp(Math.round((v.scale + 0.05 * notch) * 100) / 100, 1.05, 4),
      }),
      `scale:${z.id}`,
    );
  };
  const shown = draft ?? project;
  const axis = axisFor(shown);
  const clipProps = {
    axis,
    snap: (x: number, exclude: string) => snapX(x, exclude),
    onSnapLine: setSnapLine,
  };
  const filmstripTimes = (() => {
    const a = axisFor(project),
      from = a.tl(project.trimStart),
      to = a.tl(project.trimEnd);
    return Array.from({ length: 12 }, (_, i) =>
      a.src(from + ((to - from) * i) / 12),
    );
  })();
  return (
    <div
      className="app-shell"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!recording && !busy && exportProgress === null)
          void importFile(e.dataTransfer.files[0]);
      }}
    >
      <header className="topbar">
        <button
          className="brand"
          onClick={async () => {
            setProjects(
              (await listProjects()).sort((a, b) => b.updated - a.updated),
            );
            setModal("library");
          }}
          aria-label="Open project library"
        >
          <span className="brand-mark">
            <span />
            <span />
          </span>
          <span>
            cool<span className="brand-light">story</span>
          </span>
          <ChevronDown size={13} />
        </button>
        <div className="header-divider" />
        <div className="project-name">
          <input
            aria-label="Project name"
            value={project.name}
            onChange={(e) => edit((p) => ({ ...p, name: e.target.value }))}
          />
          <span className="save-status">
            <CheckCheck size={12} />
            {saved}
          </span>
        </div>
        <div className="topbar-actions">
          <button
            className="button subtle"
            onClick={() => fileInput.current?.click()}
            disabled={busy || recording}
          >
            <Upload size={15} />
            <span>Import</span>
          </button>
          <button
            className="button record-button"
            onClick={openRecord}
            disabled={busy || recording}
          >
            <Circle size={12} fill="currentColor" />
            New recording
          </button>
          <button
            className="button primary"
            onClick={() => {
              setExportDone(false);
              setModal("export");
            }}
            disabled={recording}
          >
            <ArrowDownToLine size={16} />
            Export video
            <ChevronDown size={13} />
          </button>
        </div>
      </header>
      <main className="workspace">
        <nav className="tool-rail" aria-label="Editing tools">
          {tabs.map((item) => (
            <button
              key={item.id}
              className={`tool ${tab === item.id ? "selected" : ""}`}
              onClick={() => setTab(item.id)}
              aria-pressed={tab === item.id}
            >
              <item.icon size={20} strokeWidth={1.6} />
              <span>{item.label}</span>
            </button>
          ))}
          <div className="rail-bottom">
            <IconButton
              label="Keyboard shortcuts and help"
              onClick={() => setModal("help")}
            >
              <CircleHelp size={19} />
            </IconButton>
            <span className="avatar">S</span>
          </div>
        </nav>
        <section className="editor">
          <div className="editor-toolbar">
            <div className="project-label">
              <Clapperboard size={15} />
              <span>
                {project.demo ? "The creative workspace" : "Your recording"}
              </span>
              {project.demo && (
                <span className="sample-tag">SAMPLE PROJECT</span>
              )}
            </div>
            <div className="editor-tools">
              <IconButton
                label="Undo (Ctrl+Z)"
                disabled={!history.current.past.length}
                onClick={undo}
              >
                <Undo2 size={16} />
              </IconButton>
              <IconButton
                label="Redo (Ctrl+Shift+Z)"
                disabled={!history.current.future.length}
                onClick={redo}
              >
                <Redo2 size={16} />
              </IconButton>
              <span className="vertical-line" />
              <button
                className="fit-button"
                onClick={() => {
                  const el = canvas.current?.parentElement;
                  if (document.fullscreenElement)
                    void document.exitFullscreen();
                  else
                    void el
                      ?.requestFullscreen()
                      .catch(() =>
                        notify("Fullscreen is unavailable in this window."),
                      );
                }}
              >
                Fit
                <ChevronDown size={12} />
              </button>
            </div>
          </div>
          <div
            className="preview-area"
            onPointerDown={(e) => {
              const target = e.target as HTMLElement;
              if (target.closest("button, .preview-control")) return;
              // With an element selected, a press on the frame places it.
              if (chosenAnnotation && target.closest(".preview-frame")) return;
              setSelected(null);
            }}
          >
            <div className="preview-halo" />
            <div
              className={`preview-frame ${chosenAnnotation ? "targeting" : ""}`}
              ref={frameRef}
              style={{ aspectRatio: s.aspect.replace(":", "/") }}
              onPointerDown={(e) => {
                // Alt+drag tilts the selected 3D zoom (Alt+Shift rotates it).
                const z = selectedZoom;
                if (!e.altKey || e.button !== 0 || !z || playing) return;
                e.stopPropagation();
                e.preventDefault();
                if (!is3dZoom(z)) {
                  if (!tiltHint.current) {
                    tiltHint.current = true;
                    notify("Switch this zoom to 3D to tilt it.");
                  }
                  return;
                }
                e.currentTarget.setPointerCapture(e.pointerId);
                tiltDrag.current = {
                  id: z.id,
                  pointer: e.pointerId,
                  clientX: e.clientX,
                  clientY: e.clientY,
                  tiltX: z.tiltX ?? -10,
                  tiltY: z.tiltY ?? 18,
                  tiltZ: z.tiltZ ?? -2,
                };
              }}
              onPointerMove={(e) => {
                const d = tiltDrag.current;
                if (!d) return;
                const dx = (e.clientX - d.clientX) * 0.25,
                  dy = (e.clientY - d.clientY) * 0.25;
                editZoom(
                  d.id,
                  (v) => ({
                    ...v,
                    manualTilt: true,
                    ...(e.shiftKey
                      ? { tiltZ: clamp(d.tiltZ + dx, -30, 30) }
                      : {
                          tiltY: clamp(d.tiltY + dx, -40, 40),
                          tiltX: clamp(d.tiltX + dy, -40, 40),
                        }),
                  }),
                  `tilt:${d.id}:${d.pointer}`,
                );
              }}
              onPointerUp={() => {
                tiltDrag.current = null;
              }}
              onPointerCancel={() => {
                tiltDrag.current = null;
              }}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const x = clamp((e.clientX - r.left) / r.width, 0, 1),
                  y = clamp((e.clientY - r.top) / r.height, 0, 1);
                if (chosenAnnotation)
                  edit((p) => ({
                    ...p,
                    annotations: p.annotations.map((a) =>
                      a.id === selected ? { ...a, x, y } : a,
                    ),
                  }));
              }}
            >
              <canvas ref={canvas} aria-label="Composited video preview" />
              {focusDot && selectedZoom && (
                <div className={`preview-overlay ${aim ? "aiming" : ""}`}>
                  {aim &&
                    (() => {
                      const area = zoomArea(aim.x, aim.y, selectedZoom.scale);
                      const a = toPreview(project, time, area.left, area.top, view, true),
                        b = toPreview(
                          project,
                          time,
                          area.left + area.width,
                          area.top + area.height,
                          view,
                          true,
                        );
                      return (
                        <div
                          className="aim-area"
                          style={{
                            ...percentOf(a),
                            width: `${((b.x - a.x) / view.width) * 100}%`,
                            height: `${((b.y - a.y) / view.height) * 100}%`,
                          }}
                        />
                      );
                    })()}
                  {aim &&
                    autoZooms(project)
                      .filter((z) => z.id !== aim.id)
                      .flatMap((z): { x: number; y: number }[] =>
                        z.focus?.length ? z.focus : [z],
                      )
                      .map((f, i) => (
                        <span
                          key={i}
                          className="ghost-dot"
                          style={percentOf(
                            toPreview(project, time, f.x, f.y, view, true),
                          )}
                        />
                      ))}
                  <button
                    className="focus-dot preview-control"
                    aria-label="Focus point"
                    title="Drag to aim this zoom · scroll to change magnification"
                    style={percentOf(focusDot.at)}
                    onPointerDown={(e) => {
                      if (e.button !== 0 || e.altKey) return;
                      e.stopPropagation();
                      e.preventDefault();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      const box = frameRef.current!.getBoundingClientRect();
                      aimDrag.current = {
                        clientX: e.clientX,
                        clientY: e.clientY,
                        x: focusDot.f.x,
                        y: focusDot.f.y,
                        width: (view.card.fw / view.width) * box.width,
                        height: (view.card.fh / view.height) * box.height,
                      };
                      setAim({
                        id: selectedZoom.id,
                        key: focusDot.key,
                        x: focusDot.f.x,
                        y: focusDot.f.y,
                      });
                    }}
                    onPointerMove={(e) => {
                      const d = aimDrag.current;
                      if (!d) return;
                      const x = clamp(d.x + (e.clientX - d.clientX) / d.width, 0, 1),
                        y = clamp(d.y + (e.clientY - d.clientY) / d.height, 0, 1);
                      setAim((a) => a && { ...a, x, y });
                    }}
                    onPointerUp={(e) => {
                      const d = aimDrag.current;
                      aimDrag.current = null;
                      if (!d || !aim) return setAim(null);
                      const x = clamp(d.x + (e.clientX - d.clientX) / d.width, 0, 1),
                        y = clamp(d.y + (e.clientY - d.clientY) / d.height, 0, 1);
                      if (x !== d.x || y !== d.y)
                        editZoom(aim.id, (z) => aimZoom(z, aim.key, x, y));
                      setAim(null);
                    }}
                    onPointerCancel={() => {
                      aimDrag.current = null;
                      setAim(null);
                    }}
                  />
                </div>
              )}
              {busy && !recording && (
                <div className="preview-loading">
                  <LoaderCircle className="spin" size={24} />
                  <span>Preparing your media…</span>
                </div>
              )}
            </div>
            <div className="preview-meta">
              <span>
                <span className="tiny-dot" />
                {project.demo
                  ? "Sample project · try a 3D focus moment"
                  : `${project.points.length ? "Cursor tracking captured" : "Original capture"} · ${timecode(project.duration)}`}
              </span>
              <button
                onClick={() => {
                  setting("aspect", s.aspect === "16:9" ? "9:16" : "16:9");
                }}
              >
                <Maximize size={12} />
                {s.aspect}
                <ChevronDown size={11} />
              </button>
            </div>
          </div>
          <div className="playback-bar">
            <span className="playback-hint">
              <Sparkles size={13} />
              Select a clip to edit · drag to move
            </span>
            <div className="transport">
              <IconButton
                label="Back one second"
                onClick={() => {
                  setPlaying(false);
                  seekTo(Math.max(project.trimStart, tRef.current - 1));
                }}
              >
                <ArrowLeft size={15} />
              </IconButton>
              <button
                className="play-button"
                aria-label={playing ? "Pause playback" : "Play video"}
                onClick={() => setPlaying((v) => !v)}
              >
                {playing ? (
                  <Pause size={16} fill="currentColor" />
                ) : (
                  <Play size={16} fill="currentColor" />
                )}
              </button>
              <IconButton
                label="Forward one second"
                onClick={() => {
                  setPlaying(false);
                  seekTo(Math.min(project.trimEnd, tRef.current + 1));
                }}
              >
                <ArrowRight size={15} />
              </IconButton>
              <span className="time-display">
                <output ref={timeTextRef} aria-label="Current time" />
                <span>/ {timecode(duration)}</span>
              </span>
            </div>
            <div className="playback-right">
              <select
                aria-label="Playback speed"
                value={s.speed}
                onChange={(e) => setting("speed", +e.target.value)}
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}×
                  </option>
                ))}
              </select>
              <IconButton
                label="Preview fullscreen"
                onClick={() =>
                  void canvas.current?.parentElement
                    ?.requestFullscreen()
                    .catch(() => notify("Fullscreen is unavailable."))
                }
              >
                <Expand size={15} />
              </IconButton>
            </div>
          </div>
          <section
            className="timeline-section"
            aria-label="Video timeline"
            ref={timelineRef}
            style={
              timelineHeight
                ? ({
                    "--timeline-height": `${timelineHeight}px`,
                  } as React.CSSProperties)
                : undefined
            }
          >
            <div
              className="timeline-resize"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize timeline"
              aria-valuenow={timelineHeight ?? undefined}
              tabIndex={0}
              title="Drag to resize the timeline · double-click to reset"
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                e.currentTarget.classList.add("dragging");
                timelineDrag.current = {
                  y: e.clientY,
                  height: timelineRef.current!.getBoundingClientRect().height,
                };
              }}
              onPointerMove={(e) => {
                const drag = timelineDrag.current;
                if (drag) sizeTimeline(drag.height + drag.y - e.clientY);
              }}
              onPointerUp={(e) => {
                const drag = timelineDrag.current;
                timelineDrag.current = null;
                e.currentTarget.classList.remove("dragging");
                if (drag)
                  sizeTimeline(drag.height + drag.y - e.clientY, true);
              }}
              onPointerCancel={(e) => {
                timelineDrag.current = null;
                e.currentTarget.classList.remove("dragging");
              }}
              onDoubleClick={() => sizeTimeline(null, true)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                e.preventDefault();
                e.stopPropagation();
                const current =
                  timelineRef.current!.getBoundingClientRect().height;
                sizeTimeline(current + (e.key === "ArrowUp" ? 20 : -20), true);
              }}
            />
            <div className="timeline-toolbar">
              <div>
                <div
                  className="tool-group"
                  role="group"
                  aria-label="Timeline tool"
                >
                  <IconButton
                    label="Select tool (V)"
                    pressed={tool === "select"}
                    onClick={() => setTool("select")}
                  >
                    <MousePointer2 size={15} />
                  </IconButton>
                  <IconButton
                    label="Razor tool (C)"
                    pressed={tool === "razor"}
                    onClick={() => setTool(tool === "razor" ? "select" : "razor")}
                  >
                    <Scissors size={15} />
                  </IconButton>
                </div>
                <button
                  className="timeline-button"
                  aria-label="Split"
                  title="Split at the playhead (Ctrl+K)"
                  onClick={() => splitHere(tRef.current)}
                >
                  <SquareSplitHorizontal size={15} />
                  <span>Split</span>
                </button>
                <button
                  className="timeline-button"
                  aria-label="Add zoom"
                  onClick={() => addZoom()}
                >
                  <ZoomIn size={15} />
                  <span>Add zoom</span>
                </button>
                <span className="vertical-line" />
                <IconButton
                  label="Delete selected edit"
                  disabled={!selected}
                  onClick={() => removeSelected()}
                >
                  <Trash2 size={14} />
                </IconButton>
              </div>
              <div>
                <IconButton
                  label={`Snapping (S): ${snapOn ? "on" : "off"}`}
                  pressed={snapOn}
                  onClick={toggleSnap}
                >
                  <Magnet size={15} />
                </IconButton>
                <span className="timeline-duration">
                  {timecode(duration)} duration
                </span>
                <span className="timeline-zoom-label">−</span>
                <input
                  className="timeline-scale"
                  aria-label="Timeline zoom"
                  type="range"
                  min={1}
                  max={4}
                  step={0.25}
                  value={timelineScale}
                  onChange={(e) => setTimelineScale(+e.target.value)}
                />
                <span className="timeline-zoom-label">+</span>
              </div>
            </div>
            <div className="timeline-body">
              <div className="track-labels">
                <div />
                <span>
                  <Monitor size={14} />
                  Screen
                </span>
                <span>
                  <ZoomIn size={14} />
                  Zoom
                </span>
                <span>
                  <Subtitles size={14} />
                  Captions
                </span>
                <span>
                  <Layers size={14} />
                  Elements
                </span>
                <span>
                  <Scissors size={14} />
                  Speed
                </span>
              </div>
              <div className="tracks-scroll">
                <div
                  className={`tracks ${tool === "razor" ? "razor" : ""}`}
                  ref={tracksRef}
                  style={{ width: `${timelineScale * 100}%` }}
                  onPointerDown={scrub}
                  onPointerMove={(e) => {
                    if (
                      e.buttons === 1 &&
                      e.currentTarget.hasPointerCapture(e.pointerId)
                    )
                      scrub(e);
                  }}
                  onPointerUp={() => setSnapLine(null)}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  <div className="time-ruler">
                    {Array.from({ length: 9 }, (_, i) => (
                      <span key={i} style={{ left: `${(i / 8) * 100}%` }}>
                        {timecode((axis.total * i) / 8)}
                      </span>
                    ))}
                  </div>
                  <ScreenTrack
                    project={shown}
                    axis={axis}
                    selected={selected}
                    tool={tool}
                    title={
                      project.demo ? "Creative workspace · sample" : project.name
                    }
                    strip={<Filmstrip project={project} times={filmstripTimes} />}
                    onSelect={(id) => {
                      setSelected(id);
                      setPlaying(false);
                    }}
                    onScrub={scrubFromPiece}
                    onSplit={(t) => splitHere(t, true)}
                    onEdgeDrag={startEdgeDrag}
                    onMenu={openMenu}
                    snap={(x) => snapX(x)}
                  />
                  <div className="zoom-track">
                    {autoZooms(shown).map((z) => (
                      <TimelineClip
                        key={z.id}
                        {...z}
                        {...clipProps}
                        label={`${(z.mode || s.motionMode) === "3d" ? "3D" : "2D"} · ${z.scale.toFixed(1)}×`}
                        kind="zoom"
                        auto={
                          z.id.startsWith("auto-") &&
                          !project.zooms.some((v) => v.id === z.id)
                        }
                        onRemove={() =>
                          edit((p) => ({
                            ...p,
                            dismissedZooms: [...p.dismissedZooms, z.id],
                          }))
                        }
                        selected={selected === z.id}
                        onSelect={() => {
                          setSelected(z.id);
                          setTab("zoom");
                          seekTo((z.start + z.end) / 2);
                          setPlaying(false);
                        }}
                        onChange={(range) =>
                          edit((p) => ({
                            ...p,
                            zooms: p.zooms.some((v) => v.id === z.id)
                              ? p.zooms.map((v) =>
                                  v.id === z.id ? { ...v, ...range } : v,
                                )
                              : [...p.zooms, { ...z, ...range }],
                          }))
                        }
                      />
                    ))}
                  </div>
                  <div className="caption-track">
                    {shown.captions.map((c) => (
                      <TimelineClip
                        key={c.id}
                        {...c}
                        {...clipProps}
                        label={c.text}
                        kind="caption"
                        selected={selected === c.id}
                        onSelect={() => {
                          setSelected(c.id);
                          setTab("captions");
                          seekTo(c.start);
                          setPlaying(false);
                        }}
                        onChange={(range) =>
                          edit((p) => ({
                            ...p,
                            captions: p.captions.map((v) =>
                              v.id === c.id ? { ...v, ...range } : v,
                            ),
                          }))
                        }
                      />
                    ))}
                  </div>
                  <div className="annotation-track">
                    {shown.annotations.map((a) => (
                      <TimelineClip
                        key={a.id}
                        {...a}
                        {...clipProps}
                        label={a.type === "blur" ? "Redact" : a.type}
                        kind="annotation"
                        selected={selected === a.id}
                        onSelect={() => {
                          setSelected(a.id);
                          setTab("annotations");
                          seekTo(a.start);
                          setPlaying(false);
                        }}
                        onChange={(range) =>
                          edit((p) => ({
                            ...p,
                            annotations: p.annotations.map((v) =>
                              v.id === a.id ? { ...v, ...range } : v,
                            ),
                          }))
                        }
                      />
                    ))}
                  </div>
                  <div className="speed-track">
                    {shown.speeds.map((a) => (
                      <TimelineClip
                        key={a.id}
                        {...a}
                        {...clipProps}
                        label={`${a.rate}× speed`}
                        kind="speed"
                        auto={a.auto}
                        onRemove={() =>
                          edit((p) => ({
                            ...p,
                            speeds: p.speeds.filter((v) => v.id !== a.id),
                          }))
                        }
                        selected={selected === a.id}
                        onSelect={() => {
                          setSelected(a.id);
                          setTab("pacing");
                          seekTo(a.start);
                          setPlaying(false);
                        }}
                        onChange={(range) =>
                          edit((p) => ({
                            ...p,
                            speeds: p.speeds.map((v) =>
                              v.id === a.id ? { ...v, ...range } : v,
                            ),
                          }))
                        }
                      />
                    ))}
                  </div>
                  <div className="playhead" ref={playheadRef}>
                    <span />
                  </div>
                  {snapLine !== null && (
                    <span
                      className="snap-line"
                      style={{ left: `${(snapLine / axis.total) * 100}%` }}
                    />
                  )}
                </div>
              </div>
            </div>
            <div className="timeline-footer">
              <div className="trim-inputs">
                <Scissors size={12} />
                <label>
                  In{" "}
                  <input
                    aria-label="Trim start in seconds"
                    type="number"
                    min={0}
                    max={project.trimEnd - 0.1}
                    step={0.1}
                    value={Number(project.trimStart.toFixed(2))}
                    onChange={(e) => {
                      const start = clamp(
                        +e.target.value,
                        0,
                        project.trimEnd - 0.1,
                      );
                      edit((p) => ({ ...p, trimStart: start }));
                      seekTo(start);
                    }}
                  />
                </label>
                <label>
                  Out{" "}
                  <input
                    aria-label="Trim end in seconds"
                    type="number"
                    min={project.trimStart + 0.1}
                    max={project.duration}
                    step={0.1}
                    value={Number(project.trimEnd.toFixed(2))}
                    onChange={(e) =>
                      edit((p) => ({
                        ...p,
                        trimEnd: clamp(
                          +e.target.value,
                          p.trimStart + 0.1,
                          p.duration,
                        ),
                      }))
                    }
                  />
                </label>
                {chosenCut && (
                  <label>
                    Cut ends{" "}
                    <input
                      aria-label="Cut end in seconds"
                      type="number"
                      step={0.1}
                      value={Number(chosenCut.end.toFixed(2))}
                      onChange={(e) =>
                        edit((p) => ({
                          ...p,
                          cuts: p.cuts.map((c) =>
                            c.id === selected
                              ? {
                                  ...c,
                                  end: clamp(
                                    +e.target.value,
                                    c.start + 0.1,
                                    p.trimEnd,
                                  ),
                                }
                              : c,
                          ),
                        }))
                      }
                    />
                  </label>
                )}
              </div>
              <span>
                <kbd>space</kbd> to play / pause
              </span>
            </div>
          </section>
        </section>
        <aside className="inspector">
          <div className="inspector-heading">
            <h1>
              {tabs.find((t) => t.id === tab)?.label === "Canvas"
                ? "Make it yours"
                : tabs.find((t) => t.id === tab)?.label}
            </h1>
            <SlidersHorizontal size={16} />
          </div>
          <div className="inspector-content">
            {tab === "background" && (
              <>
                <StylePresets project={project} edit={edit} notify={notify} />
                <div className="section-title">
                  <h2>Background</h2>
                  <span className="mini-label">STYLE</span>
                </div>
                <div className="segmented">
                  {["Gradient", "Solid", "Image"].map((t) => (
                    <button
                      className={backgroundTab === t ? "active" : ""}
                      key={t}
                      onClick={() => {
                        setBackgroundTab(t);
                        if (t === "Solid") setting("background", "solid");
                        if (
                          t === "Gradient" &&
                          !backgrounds.some((b) => b.id === s.background)
                        )
                          setting("background", "dune");
                        if (t === "Image" && project.backgroundImage)
                          setting("background", "image");
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                {backgroundTab === "Gradient" && (
                  <div className="background-grid">
                    {backgrounds.map((b) => (
                      <button
                        key={b.id}
                        className={`background-swatch ${s.background === b.id ? "selected" : ""}`}
                        style={{
                          background: `linear-gradient(135deg, ${b.colors.join(",")})`,
                        }}
                        title={b.name}
                        aria-label={`${b.name} background`}
                        onClick={() => setting("background", b.id)}
                      >
                        {s.background === b.id && <Check size={17} />}
                        <span>{b.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                {backgroundTab === "Solid" && (
                  <label className="color-control">
                    <input
                      aria-label="Background color"
                      type="color"
                      value={s.color}
                      onChange={(e) => setting("color", e.target.value)}
                    />
                    <span>{s.color.toUpperCase()}</span>
                  </label>
                )}
                {backgroundTab === "Image" && (
                  <button
                    className="upload-area"
                    onClick={() => imageInput.current?.click()}
                  >
                    <ImagePlus size={23} />
                    <span>
                      {project.backgroundImage
                        ? "Replace background image"
                        : "Choose a background image"}
                    </span>
                    <small>JPG, PNG or WebP · stays on this device</small>
                  </button>
                )}
                <div className="preset-caption">
                  <span>
                    {backgrounds.find((b) => b.id === s.background)?.name ||
                      (s.background === "solid"
                        ? "Custom color"
                        : "Custom image")}
                  </span>
                  <span>Made to stand out</span>
                </div>
                <div className="section-divider" />
                <div className="section-title">
                  <h2>Composition</h2>
                  <button
                    className="text-button"
                    onClick={() =>
                      edit((p) => ({
                        ...p,
                        settings: {
                          ...p.settings,
                          padding: defaults.padding,
                          radius: defaults.radius,
                          shadow: defaults.shadow,
                          crop: 0,
                          aspect: "16:9",
                        },
                      }))
                    }
                  >
                    Reset
                  </button>
                </div>
                <label className="select-field">
                  <span>Aspect ratio</span>
                  <select
                    aria-label="Aspect ratio"
                    value={s.aspect}
                    onChange={(e) => setting("aspect", e.target.value)}
                  >
                    <option value="16:9">16:9 · Landscape</option>
                    <option value="9:16">9:16 · Portrait</option>
                    <option value="1:1">1:1 · Square</option>
                    <option value="4:3">4:3 · Classic</option>
                    <option value="4:5">4:5 · Social</option>
                    <option value="21:9">21:9 · Cinema</option>
                  </select>
                </label>
                <Slider
                  label="Padding"
                  value={s.padding}
                  max={25}
                  unit="%"
                  onChange={(v) => setting("padding", v)}
                />
                <Slider
                  label="Roundness"
                  value={s.radius}
                  max={40}
                  unit=" px"
                  onChange={(v) => setting("radius", v)}
                />
                <Slider
                  label="Shadow"
                  value={s.shadow}
                  unit="%"
                  onChange={(v) => setting("shadow", v)}
                />
                <Slider
                  label="Crop to fill"
                  value={s.crop}
                  max={100}
                  unit="%"
                  onChange={(v) => setting("crop", v)}
                />
                <label className="select-field">
                  <span>Window frame</span>
                  <select
                    aria-label="Window frame"
                    value={s.deviceFrame}
                    onChange={(e) =>
                      setting(
                        "deviceFrame",
                        e.target.value as Settings["deviceFrame"],
                      )
                    }
                  >
                    <option value="none">Clean edge</option>
                    <option value="browser">Browser title bar</option>
                  </select>
                </label>
                <label className="select-field">
                  <span>Watermark</span>
                  <input
                    aria-label="Watermark text"
                    placeholder="Your brand or handle"
                    maxLength={80}
                    value={s.watermark}
                    onChange={(e) => setting("watermark", e.target.value)}
                  />
                </label>
                {s.watermark && (
                  <Slider
                    label="Watermark opacity"
                    value={s.watermarkOpacity}
                    unit="%"
                    onChange={(v) => setting("watermarkOpacity", v)}
                  />
                )}
                <div className="inspector-note">
                  <Sparkles size={16} />
                  <p>
                    A little framing goes a long way.
                    <br />
                    <span>Your screen. With a little more you.</span>
                  </p>
                </div>
              </>
            )}
            {tab === "zoom" && (
              <MotionPanel
                project={project}
                edit={edit}
                notify={notify}
                selected={selected}
                onAdd={addZoom}
                onSelect={(id, t) => {
                  setSelected(id);
                  seekTo(t);
                  setPlaying(false);
                }}
              />
            )}
            {tab === "cursor" && (
              <CursorPanel
                project={project}
                edit={edit}
                notify={notify}
                time={currentTime}
              />
            )}
            {tab === "pacing" && (
              <TimelineEdits
                project={project}
                edit={edit}
                notify={notify}
                time={currentTime}
                selected={selected}
                onSelect={(id) => {
                  setSelected(id);
                  const z = project.speeds.find((v) => v.id === id);
                  if (z) seekTo(z.start);
                  setPlaying(false);
                }}
              />
            )}
            {tab === "audio" && (
              <>
                <AudioExtras project={project} edit={edit} notify={notify} />
                <div className="section-title">
                  <h2>Recording audio</h2>
                  <Volume2 size={15} />
                </div>
                <Slider
                  label="Source volume"
                  value={s.volume}
                  unit="%"
                  onChange={(v) => setting("volume", v)}
                />
                <p className="helper-text">
                  {project.demo
                    ? "The sample project is silent. Import music to add a soundtrack."
                    : "Controls internal audio captured with your screen."}
                </p>
                <div className="section-divider" />
                <div className="section-title">
                  <h2>Background music</h2>
                  <Music2 size={15} />
                </div>
                <button
                  className="upload-area"
                  onClick={() => audioInput.current?.click()}
                >
                  <Music2 size={24} />
                  <span>
                    {project.music
                      ? "Replace soundtrack"
                      : "Add your soundtrack"}
                  </span>
                  <small>Import an MP3, WAV, M4A or Ogg file</small>
                </button>
                {project.music && (
                  <>
                    <Slider
                      label="Music volume"
                      value={s.musicVolume}
                      unit="%"
                      onChange={(v) => setting("musicVolume", v)}
                    />
                    <p className="helper-text">
                      Music loops to fill the exported video.
                    </p>
                    <button
                      className="button full-width"
                      onClick={() => edit((p) => ({ ...p, music: undefined }))}
                    >
                      <Trash2 size={14} />
                      Remove soundtrack
                    </button>
                  </>
                )}
                <div className="section-divider" />
                <div className="inspector-note">
                  <Subtitles size={16} />
                  <p>
                    Clean audio starts at the source.
                    <br />
                    <span>Enable noise suppression when recording.</span>
                  </p>
                </div>
              </>
            )}
            {tab === "captions" && (
              <>
                <CaptionStyle project={project} edit={edit} notify={notify} />
                <Toggle
                  label="Show captions"
                  checked={s.captions}
                  onChange={(v) => setting("captions", v)}
                />
                <div className="button-pair">
                  <button
                    className="button"
                    onClick={() => captionInput.current?.click()}
                  >
                    <Upload size={14} />
                    Import SRT
                  </button>
                  <button
                    className="button"
                    onClick={() => {
                      const id = uid();
                      const start = Math.min(
                        tRef.current,
                        project.trimEnd - 0.2,
                      );
                      edit((p) => ({
                        ...p,
                        captions: [
                          ...p.captions,
                          {
                            id,
                            start,
                            end: Math.min(start + 3, p.trimEnd),
                            text: "Your words, right here.",
                          },
                        ],
                      }));
                      setSelected(id);
                    }}
                  >
                    <Plus size={14} />
                    Add
                  </button>
                </div>
                <p className="helper-text">
                  Write captions or import an SRT transcript. Captions are
                  burned into your export.
                </p>
                <div className="caption-list">
                  {project.captions.map((c) => (
                    <div
                      key={c.id}
                      className={`caption-editor ${selected === c.id ? "selected" : ""}`}
                      onClick={() => setSelected(c.id)}
                    >
                      <div>
                        <button
                          className="caption-time"
                          onClick={() => {
                            seekTo(c.start);
                            setPlaying(false);
                          }}
                        >
                          {timecode(c.start)} — {timecode(c.end)}
                        </button>
                        <IconButton
                          label="Delete caption"
                          onClick={() =>
                            edit((p) => ({
                              ...p,
                              captions: p.captions.filter((v) => v.id !== c.id),
                            }))
                          }
                        >
                          <X size={13} />
                        </IconButton>
                      </div>
                      <textarea
                        aria-label="Caption text"
                        value={c.text}
                        rows={2}
                        onChange={(e) =>
                          edit((p) => ({
                            ...p,
                            captions: p.captions.map((v) =>
                              v.id === c.id
                                ? { ...v, text: e.target.value }
                                : v,
                            ),
                          }))
                        }
                      />
                      <div className="two-fields">
                        <label>
                          In
                          <input
                            aria-label="Caption start"
                            type="number"
                            min={0}
                            step={0.1}
                            value={+c.start.toFixed(2)}
                            onChange={(e) =>
                              edit((p) => ({
                                ...p,
                                captions: p.captions.map((v) =>
                                  v.id === c.id
                                    ? {
                                        ...v,
                                        start: clamp(
                                          +e.target.value,
                                          0,
                                          c.end - 0.1,
                                        ),
                                      }
                                    : v,
                                ),
                              }))
                            }
                          />
                        </label>
                        <label>
                          Out
                          <input
                            aria-label="Caption end"
                            type="number"
                            step={0.1}
                            value={+c.end.toFixed(2)}
                            onChange={(e) =>
                              edit((p) => ({
                                ...p,
                                captions: p.captions.map((v) =>
                                  v.id === c.id
                                    ? {
                                        ...v,
                                        end: clamp(
                                          +e.target.value,
                                          c.start + 0.1,
                                          p.duration,
                                        ),
                                      }
                                    : v,
                                ),
                              }))
                            }
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {tab === "annotations" && (
              <>
                <div className="section-title">
                  <h2>Say it with a little emphasis.</h2>
                </div>
                <div className="annotation-buttons">
                  {[
                    { type: "text", label: "Text", icon: Type },
                    { type: "arrow", label: "Arrow", icon: ArrowRight },
                    { type: "blur", label: "Redact", icon: Square },
                    { type: "spotlight", label: "Spotlight", icon: Circle },
                    { type: "soft-blur", label: "Blur", icon: Move },
                    { type: "rectangle", label: "Box", icon: Square },
                    { type: "ellipse", label: "Circle", icon: Circle },
                    { type: "step", label: "Step", icon: Plus },
                  ].map((a) => (
                    <button
                      key={a.type}
                      onClick={() => {
                        const id = uid();
                        const start = Math.min(
                          tRef.current,
                          project.trimEnd - 0.2,
                        );
                        edit((p) => ({
                          ...p,
                          annotations: [
                            ...p.annotations,
                            {
                              id,
                              type: a.type as "text",
                              start,
                              end: Math.min(start + 3, p.trimEnd),
                              text:
                                a.type === "step"
                                  ? "1"
                                  : "Look a little closer",
                              x: 0.3,
                              y: 0.4,
                              width: 0.2,
                              height: 0.12,
                            },
                          ],
                        }));
                        setSelected(id);
                      }}
                    >
                      <a.icon size={22} />
                      <span>{a.label}</span>
                    </button>
                  ))}
                </div>
                <p className="helper-text">
                  Add an element at the playhead, then click the preview to
                  place it. Redact uses an opaque mask to conceal details.
                </p>
                {chosenAnnotation && (
                  <>
                    <div className="section-divider" />
                    <div className="section-title">
                      <h2>Selected element</h2>
                      <IconButton
                        label="Remove element"
                        onClick={removeSelected}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                    {(chosenAnnotation.type === "text" ||
                      chosenAnnotation.type === "step") && (
                      <textarea
                        className="annotation-text"
                        aria-label="Annotation text"
                        value={chosenAnnotation.text}
                        onChange={(e) =>
                          edit((p) => ({
                            ...p,
                            annotations: p.annotations.map((a) =>
                              a.id === selected
                                ? { ...a, text: e.target.value }
                                : a,
                            ),
                          }))
                        }
                      />
                    )}
                    <label className="color-control">
                      <input
                        aria-label="Element color"
                        type="color"
                        value={chosenAnnotation.color || "#efb18c"}
                        onChange={(e) =>
                          edit((p) => ({
                            ...p,
                            annotations: p.annotations.map((a) =>
                              a.id === selected
                                ? { ...a, color: e.target.value }
                                : a,
                            ),
                          }))
                        }
                      />
                      <span>Element color</span>
                    </label>
                    {chosenAnnotation.type === "soft-blur" && (
                      <Slider
                        label="Blur strength"
                        min={4}
                        max={35}
                        value={chosenAnnotation.intensity || 12}
                        onChange={(intensity) =>
                          edit((p) => ({
                            ...p,
                            annotations: p.annotations.map((a) =>
                              a.id === selected ? { ...a, intensity } : a,
                            ),
                          }))
                        }
                      />
                    )}
                    <Slider
                      label="Width"
                      value={chosenAnnotation.width * 100}
                      min={5}
                      max={80}
                      unit="%"
                      onChange={(v) =>
                        edit((p) => ({
                          ...p,
                          annotations: p.annotations.map((a) =>
                            a.id === selected ? { ...a, width: v / 100 } : a,
                          ),
                        }))
                      }
                    />
                    <Slider
                      label="Height"
                      value={chosenAnnotation.height * 100}
                      min={5}
                      max={80}
                      unit="%"
                      onChange={(v) =>
                        edit((p) => ({
                          ...p,
                          annotations: p.annotations.map((a) =>
                            a.id === selected ? { ...a, height: v / 100 } : a,
                          ),
                        }))
                      }
                    />
                    <div className="two-fields">
                      <label>
                        In (s)
                        <input
                          type="number"
                          step={0.1}
                          value={+chosenAnnotation.start.toFixed(2)}
                          onChange={(e) =>
                            edit((p) => ({
                              ...p,
                              annotations: p.annotations.map((a) =>
                                a.id === selected
                                  ? {
                                      ...a,
                                      start: clamp(
                                        +e.target.value,
                                        0,
                                        a.end - 0.1,
                                      ),
                                    }
                                  : a,
                              ),
                            }))
                          }
                        />
                      </label>
                      <label>
                        Out (s)
                        <input
                          type="number"
                          step={0.1}
                          value={+chosenAnnotation.end.toFixed(2)}
                          onChange={(e) =>
                            edit((p) => ({
                              ...p,
                              annotations: p.annotations.map((a) =>
                                a.id === selected
                                  ? {
                                      ...a,
                                      end: clamp(
                                        +e.target.value,
                                        a.start + 0.1,
                                        p.duration,
                                      ),
                                    }
                                  : a,
                              ),
                            }))
                          }
                        />
                      </label>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
          <div className="inspector-footer">
            <span className="local-dot" />
            Local by design.<span>Your recordings stay yours.</span>
          </div>
        </aside>
      </main>
      <footer className="app-footer">
        <span>
          <span className="status-dot" />
          {window.studioDesktop ? "Desktop studio" : "Local workspace"}
          <span className="footer-dot">·</span>
          {saved === "Saved locally"
            ? "All changes saved on this device"
            : saved}
        </span>
        <span>
          Less editing. More creating.
          <span className="version">v{__APP_VERSION__}</span>
        </span>
      </footer>
      {menu && (
        <TimelineMenu
          x={menu.x}
          y={menu.y}
          label={
            menu.target.kind === "piece"
              ? "Clip actions"
              : menu.target.kind === "gap"
                ? "Gap actions"
                : "Removed footage"
          }
          items={menuItems(menu.target)}
          onClose={closeMenu}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          {toastAction && (
            <button
              className="button subtle"
              onClick={() => {
                toastAction.run();
                setToast("");
                setToastAction(null);
              }}
            >
              {toastAction.label}
            </button>
          )}
          <IconButton label="Dismiss notification" onClick={() => setToast("")}>
            <X size={14} />
          </IconButton>
        </div>
      )}
      {recording && !window.studioDesktop && (
        <div className="recording-dock" role="status">
          <span className={`recording-dot ${recordPaused ? "paused" : ""}`} />
          <div>
            <strong>{recordPaused ? "Paused" : "Recording"}</strong>
            <span>{timecode(recordTime)}</span>
          </div>
          <IconButton
            label={recordPaused ? "Resume recording" : "Pause recording"}
            onClick={() => {
              if (recordPaused) captureRef.current?.resume();
              else captureRef.current?.pause();
              setRecordPaused((v) => !v);
            }}
          >
            {recordPaused ? <Play size={17} /> : <Pause size={17} />}
          </IconButton>
          <button
            className="button primary"
            onClick={() => captureRef.current?.stop()}
          >
            <Square size={13} fill="currentColor" />
            Finish recording
          </button>
          <IconButton
            label="Toggle speaker notes"
            onClick={() => setShowNotes((v) => !v)}
          >
            <Type size={17} />
          </IconButton>
          {window.studioDesktop && <kbd>Ctrl Shift R</kbd>}
        </div>
      )}
      {recording && showNotes && !window.studioDesktop && (
        <div className="speaker-notes">
          <div>
            <strong>Speaker notes</strong>
            <IconButton
              label="Hide speaker notes"
              onClick={() => setShowNotes(false)}
            >
              <X size={14} />
            </IconButton>
          </div>
          <textarea
            aria-label="Live speaker notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      )}
      {modal === "record" && (
        <Modal
          title="Your next great take."
          subtitle="Pick your source. Find your flow. We’ll take care of the frame."
          onClose={closeModal}
        >
          <div className="record-source">
            <Monitor size={32} />
            <div>
              <strong>Screen recording</strong>
              <p>
                {window.studioDesktop
                  ? "Choose a display or window below."
                  : "Choose a screen, window or browser tab in the sharing dialog."}
              </p>
            </div>
          </div>
          {window.studioDesktop && (
            <div className="source-grid">
              {sources.map((item) => (
                <button
                  key={item.id}
                  className={source === item.id ? "selected" : ""}
                  onClick={() => setSource(item.id)}
                >
                  <img src={item.thumbnail} alt="" />
                  <span>{item.name}</span>
                  {source === item.id && <Check size={14} />}
                </button>
              ))}
            </div>
          )}
          <RegionPicker
            enabled={regionEnabled}
            region={region}
            thumbnail={sources.find((s) => s.id === source)?.thumbnail}
            onToggle={setRegionEnabled}
            onChange={setRegion}
          />
          <Toggle
            label="System audio"
            checked={systemAudio}
            onChange={setSystemAudio}
            description="Availability depends on the selected source"
          />
          <label className="select-field">
            <span>Frame rate</span>
            <select
              aria-label="Recording frame rate"
              value={recordFps}
              onChange={(e) => setRecordFps(+e.target.value)}
            >
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </label>
          {window.studioDesktop && (
            <Toggle
              label="3-second countdown"
              checked={countdown}
              onChange={(value) => {
                setCountdown(value);
                try {
                  localStorage.setItem(
                    "studio-countdown",
                    value ? "on" : "off",
                  );
                } catch {}
              }}
              description="Cool Story hides while you record"
            />
          )}
          <details className="notes-details">
            <summary>
              Speaker notes <Type size={14} />
            </summary>
            <textarea
              aria-label="Speaker notes"
              placeholder="A few words to keep you on track…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <small>
              {window.studioDesktop
                ? "Open them from the recording bar. They never appear in the video."
                : "Notes are visible in this app. If you record this window, they will be captured."}
            </small>
          </details>
          <div className="modal-actions">
            <button className="button" onClick={closeModal}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={startRecord}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Circle size={12} fill="currentColor" />
              )}
              {busy ? "Preparing capture…" : "Start recording"}
            </button>
          </div>
        </Modal>
      )}
      {modal === "export" && (
        <Modal
          title={
            exportDone ? "Ready for its close-up." : "Let’s put it out there."
          }
          subtitle={
            exportDone
              ? exportedPath
                ? `Saved to ${folderName(exportedPath)}.`
                : "Your video has been sent to your downloads."
              : "Beautifully framed. Entirely yours. No watermark."
          }
          onClose={closeModal}
        >
          <div className="export-summary">
            <span className="export-art">
              <Clapperboard size={30} />
            </span>
            <div>
              <strong>{project.name}</strong>
              <span>
                {timecode(duration)} · {s.aspect} ·{" "}
                {project.demo ? "Sample project" : "Screen recording"}
              </span>
            </div>
            <Check size={18} />
          </div>
          {exportDone ? (
            <div className="export-success">
              <CheckCheck size={36} />
              <h3>That’s a wrap.</h3>
              <p>
                Keep the editable project too, so your next version is just a
                few clicks away.
              </p>
              {exportedPath && (
                <button
                  className="button"
                  onClick={() =>
                    void window.studioDesktop?.exportFile.reveal(exportedPath)
                  }
                >
                  <FolderOpen size={15} />
                  Show in folder
                </button>
              )}
            </div>
          ) : (
            <>
              <label className="select-field">
                <span>Format</span>
                <select
                  aria-label="Export format"
                  disabled={exportProgress !== null}
                  value={exportFormat}
                  onChange={(e) =>
                    setExportFormat(e.target.value as ExportFormat)
                  }
                >
                  <option value="mp4">MP4 · H.264, plays everywhere</option>
                  <option value="webm">WebM · VP9</option>
                  <option value="gif">GIF · silent, looping</option>
                </select>
              </label>
              <label className="select-field">
                <span>Resolution</span>
                <select
                  aria-label="Export resolution"
                  disabled={exportProgress !== null}
                  value={exportHeight}
                  onChange={(e) => setExportHeight(+e.target.value)}
                >
                  <option value={720}>720p · compact</option>
                  <option value={1080}>1080p · full HD</option>
                  <option value={2160}>2160p · 4K</option>
                </select>
              </label>
              <label className="select-field">
                <span>Frame rate</span>
                <select
                  aria-label="Export frame rate"
                  disabled={exportProgress !== null}
                  value={exportFps}
                  onChange={(e) => setExportFps(+e.target.value)}
                >
                  <option value={30}>30 fps</option>
                  <option value={60}>60 fps</option>
                </select>
              </label>
              <div className="export-info">
                <Monitor size={16} />
                <p>
                  {exportFormat === "gif"
                    ? "GIF exports use up to 480p and 15 fps to keep files manageable. Long GIFs can use significant memory."
                    : "Renders frame by frame on this computer's graphics card, usually faster than real time. You can minimize the window while it works."}
                </p>
              </div>
            </>
          )}
          {exportProgress !== null && (
            <div
              className="export-progress"
              role="progressbar"
              aria-label="Export progress"
              aria-valuenow={Math.round(exportProgress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div>
                <span>
                  Rendering your story…
                  {exportSpeed > 0 && ` ${exportSpeed.toFixed(1)}× real time`}
                </span>
                <strong>{Math.round(exportProgress * 100)}%</strong>
              </div>
              <span>
                <span style={{ width: `${exportProgress * 100}%` }} />
              </span>
            </div>
          )}
          <div className="modal-actions spread">
            <button
              className="button subtle"
              disabled={exportProgress !== null}
              onClick={async () => {
                download(
                  await projectFile(project),
                  `${project.name || "project"}.studio`,
                );
                notify("Editable project downloaded with its media.");
              }}
            >
              <Download size={15} />
              Save project
            </button>
            {exportProgress !== null ? (
              <button
                className="button"
                onClick={() => abortRef.current?.abort()}
              >
                Cancel export
              </button>
            ) : (
              <button
                className="button primary"
                onClick={() => void runExport()}
              >
                <ArrowDownToLine size={16} />
                {exportDone ? "Export again" : "Export video"}
              </button>
            )}
          </div>
          <button
            className="snapshot-button"
            disabled={exportProgress !== null}
            onClick={() =>
              canvas.current?.toBlob((blob) => {
                if (blob) download(blob, `${project.name}-frame.png`);
              })
            }
          >
            Or save the current frame as PNG <ArrowRight size={12} />
          </button>
        </Modal>
      )}
      {modal === "library" && (
        <Modal
          title="Your creative space."
          subtitle="Projects live on this device. Download a project to take it with you."
          onClose={closeModal}
          wide
        >
          <div className="library-actions">
            <button className="button primary" onClick={openRecord}>
              <Plus size={15} />
              New recording
            </button>
            <button
              className="button"
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={15} />
              Import video or project
            </button>
            <button
              className="button subtle"
              onClick={() => openProject(newProject())}
            >
              <Sparkles size={15} />
              Open sample
            </button>
          </div>
          <div className="project-list">
            {projects.map((p) => (
              <div className="project-card" key={p.id}>
                <button onClick={() => openProject(p)}>
                  <span
                    className="project-thumbnail"
                    style={{
                      background: `linear-gradient(135deg, ${(backgrounds.find((b) => b.id === p.settings.background)?.colors || [p.settings.color, p.settings.color]).join(",")})`,
                    }}
                  >
                    <Monitor size={27} />
                  </span>
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {timecode(outputDuration(p))} ·{" "}
                      {p.demo ? "Sample" : "Recording"} ·{" "}
                      {new Date(p.updated).toLocaleDateString()}
                    </small>
                  </span>
                  <ChevronRight size={16} />
                </button>
                <IconButton
                  label={`Delete ${p.name}`}
                  onClick={async () => {
                    await deleteProject(p.id);
                    setProjects((v) => v.filter((item) => item.id !== p.id));
                    notify(
                      "Removed from the library. An open project will be saved again when edited.",
                    );
                  }}
                >
                  <Trash2 size={16} />
                </IconButton>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {modal === "help" && (
        <Modal
          title="A little help, a lot of possibility."
          subtitle="Everything you need to find your flow."
          onClose={closeModal}
        >
          <div className="shortcut-list">
            {[
              ["Play / pause", "Space"],
              ["Previous / next frame", "← / →"],
              ["Skip one second", "Shift + ← / →"],
              ["Undo", "Ctrl / ⌘ + Z"],
              ["Redo", "Ctrl / ⌘ + Shift + Z"],
              ["Remove selected edit (a clip leaves a gap)", "Delete"],
              ["Split at the playhead", "Ctrl + K"],
              ["Ripple delete the selected clip", "Shift + Delete"],
              ["Razor tool / select tool", "C / V"],
              ["Snapping on or off", "S"],
              ["Stop desktop recording", "Ctrl + Shift + R"],
              ["Quick export (last settings)", "Ctrl + E"],
              ["Bigger / smaller interface", "Ctrl + = / Ctrl + −"],
            ].map(([a, b]) => (
              <div key={a}>
                <span>{a}</span>
                <kbd>{b}</kbd>
              </div>
            ))}
          </div>
          <p className="helper-text">
            Drag a video or .studio project into the workspace to open it. Click
            a zoom or element on the timeline to edit it. Save an editable
            project from the export dialog to keep a portable backup.
          </p>
          <div className="export-info">
            <FolderOpen size={18} />
            <p>
              This build supports local capture and editing. Automatic
              transcription, mobile capture, and cloud sharing are not available
              yet. Camera capture is deferred.
            </p>
          </div>
        </Modal>
      )}
      <input
        aria-label="Import video or project"
        ref={fileInput}
        type="file"
        hidden
        accept="video/*,.studio"
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      <input
        ref={imageInput}
        type="file"
        hidden
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file)
            edit((p) => ({
              ...p,
              backgroundImage: file,
              settings: { ...p.settings, background: "image" },
            }));
          e.target.value = "";
        }}
      />
      <input
        ref={audioInput}
        type="file"
        hidden
        accept="audio/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) edit((p) => ({ ...p, music: file }));
          e.target.value = "";
        }}
      />
      <input
        ref={captionInput}
        type="file"
        hidden
        accept=".srt,.vtt"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) {
            const captions = parseSrt(await file.text())
              .filter((c) => c.start < project.duration)
              .map((c) => ({ ...c, end: Math.min(c.end, project.duration) }));
            if (captions.length) {
              edit((p) => ({ ...p, captions }));
              notify(`Imported ${captions.length} captions.`);
            } else
              notify(
                "No valid captions were found within this video’s duration.",
              );
          }
          if (captionInput.current) captionInput.current.value = "";
        }}
      />
    </div>
  );
}
