export type Point = {
  t: number;
  x: number;
  y: number;
  click?: boolean;
  shortcut?: string;
  typing?: boolean;
  /** Right mouse button pressed. */
  right?: boolean;
  /** Wheel movement (120 per notch; negative is toward the user). */
  wheel?: number;
  /** Cursor shape from this moment on: arrow, text, pointer, … */
  cursor?: string;
};
export type Zoom = {
  id: string;
  start: number;
  end: number;
  x: number;
  y: number;
  scale: number;
  mode?: "2d" | "3d";
  follow?: boolean;
  tiltX?: number;
  tiltY?: number;
  tiltZ?: number;
  offsetX?: number;
  offsetY?: number;
  perspective?: number;
  /**
   * Click-driven focus changes inside an automatic zoom (source seconds).
   * `click` is when the click itself happened; the camera starts at `t`.
   */
  focus?: { t: number; x: number; y: number; click?: number }[];
};
export type Caption = { id: string; start: number; end: number; text: string };
export type Annotation = {
  id: string;
  start: number;
  end: number;
  type:
    | "text"
    | "arrow"
    | "blur"
    | "spotlight"
    | "soft-blur"
    | "rectangle"
    | "ellipse"
    | "step";
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  intensity?: number;
};
export type Cut = { id: string; start: number; end: number };
export type SpeedSection = Cut & {
  rate: number;
  /** Added by the automatic edit; removable on its own or via Back to raw. */
  auto?: boolean;
};
export type Settings = {
  background: string;
  color: string;
  padding: number;
  radius: number;
  shadow: number;
  aspect: string;
  cursorSize: number;
  cursorHighlight: boolean;
  showCursor: boolean;
  autoZoom: boolean;
  zoomStrength: number;
  speed: number;
  volume: number;
  musicVolume: number;
  cameraSize: number;
  cameraPosition: string;
  cameraRound: boolean;
  cameraMirror: boolean;
  showCamera: boolean;
  captions: boolean;
  crop: number;
  motionMode: "2d" | "3d";
  motionIntensity: number;
  motionEase: "focused" | "smooth" | "gentle" | "custom";
  /** Camera spring: roughly how long a move takes, in seconds. */
  cameraResponse: number;
  /** Camera spring overshoot: 0 glides in, higher values bounce. */
  cameraBounce: number;
  /** Extra seconds automatic zooms start moving before a click, on top of the feel's own lead. */
  zoomLead: number;
  motionBlur: number;
  followCursor: boolean;
  cursorStyle: "dark" | "light" | "dot";
  cursorSmoothing: number;
  cursorIdle: boolean;
  cursorAngle: number;
  clickStyle: "ring" | "pulse";
  clickVolume: number;
  showShortcuts: boolean;
  captionTheme: "classic" | "light" | "minimal";
  captionSize: number;
  captionPosition: number;
  musicFade: number;
  sourceFade: number;
  deviceFrame: "none" | "browser";
  watermark: string;
  watermarkOpacity: number;
};
export type Project = {
  id: string;
  name: string;
  updated: number;
  duration: number;
  demo: boolean;
  settings: Settings;
  zooms: Zoom[];
  captions: Caption[];
  annotations: Annotation[];
  cuts: Cut[];
  speeds: SpeedSection[];
  hiddenCursor: Cut[];
  dismissedZooms: string[];
  trimStart: number;
  trimEnd: number;
  points: Point[];
  /** How the footage was captured: "native" has no cursor baked into the pixels. */
  capture?: "native" | "legacy";
  /** Recording folder on disk (native recordings). */
  folder?: string;
  /** Streamed from disk instead of stored in the browser database. */
  videoUrl?: string;
  /** Trim before the automatic edit, so Back to raw can restore it. */
  autoEdit?: { trimStart: number; trimEnd: number };
  /** [seconds, changed share of the screen] for idle detection. */
  activity?: [number, number][];
  video?: Blob;
  camera?: Blob;
  music?: Blob;
  backgroundImage?: Blob;
};
export const defaults: Settings = {
  background: "dune",
  color: "#df9977",
  padding: 8,
  radius: 14,
  shadow: 45,
  aspect: "16:9",
  cursorSize: 1.5,
  cursorHighlight: true,
  showCursor: true,
  autoZoom: true,
  zoomStrength: 1.65,
  speed: 1,
  volume: 100,
  musicVolume: 20,
  cameraSize: 20,
  cameraPosition: "bottom-right",
  cameraRound: true,
  cameraMirror: true,
  showCamera: true,
  captions: true,
  crop: 0,
  motionMode: "2d",
  motionIntensity: 18,
  motionEase: "smooth",
  cameraResponse: 0.6,
  cameraBounce: 0,
  zoomLead: 0.5,
  motionBlur: 0,
  followCursor: true,
  cursorStyle: "dark",
  cursorSmoothing: 0.08,
  cursorIdle: false,
  cursorAngle: 0,
  clickStyle: "ring",
  clickVolume: 0,
  showShortcuts: true,
  captionTheme: "classic",
  captionSize: 3,
  captionPosition: 92,
  musicFade: 0.5,
  sourceFade: 0,
  deviceFrame: "none",
  watermark: "",
  watermarkOpacity: 65,
};
/** Named camera feels shown as Snappy / Smooth / Floaty. */
export const cameraFeel = {
  focused: { response: 0.38, bounce: 0.08 },
  smooth: { response: 0.6, bounce: 0 },
  gentle: { response: 0.95, bounce: 0 },
} as const;
export const backgrounds = [
  { id: "dune", name: "Dune", colors: ["#f5cd9e", "#d97c68", "#98495b"] },
  { id: "sage", name: "Sage", colors: ["#d8e5c7", "#83a58c", "#365d56"] },
  { id: "bloom", name: "Bloom", colors: ["#ead8e7", "#bb91ad", "#755b91"] },
  { id: "ocean", name: "Ocean", colors: ["#bfdee1", "#6ea4b8", "#355d78"] },
  { id: "sand", name: "Sand", colors: ["#f0eadb", "#c8b69a", "#aa8f77"] },
  {
    id: "midnight",
    name: "Midnight",
    colors: ["#3d464c", "#242c34", "#111b27"],
  },
  { id: "peach", name: "Peach", colors: ["#ffe5cb", "#f5af93", "#d58470"] },
  { id: "paper", name: "Paper", colors: ["#f6f3ee", "#e5e1d9", "#d5cec3"] },
];
export function newProject(demo = true): Project {
  return {
    id: crypto.randomUUID(),
    name: demo ? "A little less ordinary" : "Untitled recording",
    updated: Date.now(),
    duration: demo ? 24 : 0,
    demo,
    settings: { ...defaults },
    zooms: [],
    annotations: [],
    cuts: [],
    speeds: [],
    hiddenCursor: [],
    dismissedZooms: [],
    points: [],
    trimStart: 0,
    trimEnd: demo ? 24 : 0,
    captions: demo
      ? [
          {
            id: "welcome",
            start: 1,
            end: 5,
            text: "A little space for your next big idea.",
          },
          {
            id: "focus",
            start: 9,
            end: 13,
            text: "Bring everything together. Beautifully.",
          },
          {
            id: "done",
            start: 18,
            end: 22,
            text: "Make room for what matters.",
          },
        ]
      : [],
  };
}
export type DesktopSource = {
  id: string;
  name: string;
  thumbnail: string;
  displayId: string;
};
declare global {
  interface Window {
    studioDesktop?: {
      sources: () => Promise<DesktopSource[]>;
      selectSource: (id: string) => Promise<void>;
      track: (enabled: boolean) => Promise<void>;
      onPoint: (
        cb: (point: {
          x: number;
          y: number;
          click: boolean;
          shortcut?: string;
          typing?: boolean;
        }) => void,
      ) => () => void;
      onStop: (cb: () => void) => () => void;
      recordingUi: (
        state:
          | { phase: "countdown"; seconds: number }
          | { phase: "recording"; notes: string }
          | { phase: "status"; elapsed: number; paused: boolean }
          | { phase: "idle" },
      ) => Promise<void>;
      onCommand: (
        cb: (
          command: "pause" | "resume" | "stop" | "discard",
          bar?: { x: number; y: number; width: number; height: number },
        ) => void,
      ) => () => void;
      native: {
        available: () => Promise<boolean>;
        start: (options: {
          fps: number;
          audio: boolean;
          region?: { x: number; y: number; width: number; height: number };
        }) => Promise<{
          folder: string;
          videoUrl: string;
          width: number;
          height: number;
        }>;
        command: (name: "begin" | "pause" | "resume" | "stop") => Promise<void>;
        events: (folder: string) => Promise<string>;
        onEvent: (
          cb: (message: {
            event: string;
            seconds?: number;
            paused?: boolean;
            audio?: boolean;
            reason?: string;
            message?: string;
          }) => void,
        ) => () => void;
        recoveries: () => Promise<
          { folder: string; name: string; videoUrl: string; created?: string }[]
        >;
        recovered: (folder: string) => Promise<void>;
        saveProject: (folder: string, json: string) => Promise<void>;
      };
      exportFile: {
        /** Asks where to save (Save As) unless `quick`; null when cancelled. */
        open: (
          name: string,
          extension: string,
          options?: { quick?: boolean },
        ) => Promise<{ id: string; path: string } | null>;
        write: (
          id: string,
          position: number,
          data: Uint8Array,
        ) => Promise<void>;
        close: (id: string, keep: boolean) => Promise<void>;
        reveal: (file: string) => Promise<void>;
      };
    };
    studioBar?: {
      onStatus: (
        cb: (status: {
          elapsed: number;
          paused: boolean;
          notes?: string;
        }) => void,
      ) => () => void;
      command: (name: "pause" | "resume" | "stop" | "discard") => Promise<void>;
      setExpanded: (expanded: boolean) => Promise<void>;
    };
  }
}
