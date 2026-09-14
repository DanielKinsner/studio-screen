import { cameraFeel, defaults, type Settings } from "./types";
const limits: Partial<Record<keyof Settings, [number, number]>> = {
  padding: [0, 25],
  radius: [0, 40],
  shadow: [0, 100],
  crop: [0, 100],
  speed: [0.5, 4],
  volume: [0, 100],
  musicVolume: [0, 100],
  zoomStrength: [1.1, 3],
  cursorSize: [0.5, 4],
  motionIntensity: [5, 40],
  motionBlur: [0, 100],
  cameraResponse: [0.2, 1.5],
  cameraBounce: [0, 0.4],
  cursorSmoothing: [0, 0.5],
  cursorAngle: [-90, 90],
  clickVolume: [0, 50],
  captionSize: [1.5, 6],
  captionPosition: [10, 96],
  musicFade: [0, 5],
  sourceFade: [0, 3],
  watermarkOpacity: [0, 100],
};
const choices: Partial<Record<keyof Settings, string[]>> = {
  aspect: ["16:9", "9:16", "1:1", "4:3", "4:5", "21:9"],
  motionMode: ["2d", "3d"],
  motionEase: ["focused", "smooth", "gentle", "custom"],
  cursorStyle: ["dark", "light", "dot"],
  clickStyle: ["ring", "pulse"],
  captionTheme: ["classic", "light", "minimal"],
  deviceFrame: ["none", "browser"],
};
/** Settings that make up a look: saved styles and the look new recordings reuse. */
export const styleKeys = [
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
export const lookOf = (s: Settings) =>
  Object.fromEntries(styleKeys.map((k) => [k, s[k]])) as Partial<Settings>;
const LAST_LOOK = "studio-last-look";
export function rememberLook(s: Settings) {
  try {
    localStorage.setItem(LAST_LOOK, JSON.stringify(lookOf(s)));
  } catch {}
}
/** The look of the last real project Dan edited, cleaned for safety. */
export function lastLook(): Partial<Settings> {
  try {
    return withCameraFeel(
      cleanSettings(JSON.parse(localStorage.getItem(LAST_LOOK) || "{}")),
    );
  } catch {
    return {};
  }
}

/** Restrict imported styles to known, finite settings before applying them. */
export function cleanSettings(input: unknown): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (!input || typeof input !== "object") return out;
  for (const [key, value] of Object.entries(input)) {
    const k = key as keyof Settings;
    if (!(k in defaults) || typeof value !== typeof defaults[k]) continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) continue;
      const range = limits[k];
      Object.assign(out, {
        [k]: range ? Math.max(range[0], Math.min(range[1], value)) : value,
      });
    } else if (typeof value === "string") {
      if (choices[k] && !choices[k]!.includes(value)) continue;
      if (k === "color" && !/^#[0-9a-f]{6}$/i.test(value)) continue;
      Object.assign(out, { [k]: value.slice(0, k === "watermark" ? 80 : 100) });
    } else Object.assign(out, { [k]: value });
  }
  return out;
}
/** Looks saved before the spring camera only name a movement style; add its spring. */
export function withCameraFeel(patch: Partial<Settings>): Partial<Settings> {
  const feel = cameraFeel[patch.motionEase as keyof typeof cameraFeel];
  if (!feel || patch.cameraResponse !== undefined) return patch;
  return {
    ...patch,
    cameraResponse: feel.response,
    cameraBounce: feel.bounce,
  };
}
