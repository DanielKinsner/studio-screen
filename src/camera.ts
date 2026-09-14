import type { Project, Zoom } from "./types";
import {
  autoZooms,
  clamp,
  clampCenter,
  outputTimeAt,
  playbackSegments,
} from "./timeline";
import { lastAtOrBefore, smoothPointer } from "./cursorPath";
import { memo, springStep, type Spring } from "./spring";

/** Stored camera samples per second of edited (output) time. */
const RATE = 120;
/** Simulation steps per stored sample: 1/240 s. */
const SUBSTEPS = 2;
/** Hand-placed zooms closer together than this stay zoomed in between. */
const BRIDGE = 1;
/** The cursor may roam the middle 60% of the zoomed view before the camera follows. */
const FOLLOW_ZONE = 0.3;

export type Pose = {
  x: number;
  y: number;
  z: number;
  offsetX: number;
  offsetY: number;
  perspective: number;
  scale: number;
};

// One channel per sprung value. Scale is sprung as a logarithm so zooming in
// and out feel equally fast at every magnification.
const LOG_SCALE = 0,
  CENTER_X = 1,
  CENTER_Y = 2,
  TILT_X = 3,
  TILT_Y = 4,
  TILT_Z = 5,
  OFFSET_X = 6,
  OFFSET_Y = 7,
  PERSPECTIVE = 8,
  LIFT = 9,
  CHANNELS = 10;

type Path = { samples: Float32Array; count: number };

function buildPath(p: Project): Path {
  const s = p.settings;
  const zooms = autoZooms(p);
  const starts = zooms.map((z) => z.start);
  // Largest end among zooms[0..i], to find the zoom that most recently finished.
  const reach: number[] = [];
  zooms.forEach((z, i) => {
    reach.push(i && zooms[reach[i - 1]].end >= z.end ? reach[i - 1] : i);
  });
  const hasPointer = p.demo || p.points.length > 0;

  const activeZoom = (t: number): Zoom | undefined => {
    const i = lastAtOrBefore(starts, t);
    for (let k = i; k >= 0; k--) if (zooms[k].end >= t) return zooms[k];
    if (i < 0) return undefined;
    const previous = zooms[reach[i]],
      next = zooms[i + 1];
    return next && next.start - previous.end < BRIDGE ? previous : undefined;
  };

  const target = new Float64Array(CHANNELS);
  let currentZoom: Zoom | undefined,
    currentFocus = -1,
    centerX = 0.5,
    centerY = 0.5;

  const aim = (t: number) => {
    const z = activeZoom(t);
    target.fill(0);
    target[PERSPECTIVE] = 45;
    target[CENTER_X] = 0.5;
    target[CENTER_Y] = 0.5;
    if (!z) {
      currentZoom = undefined;
      return;
    }
    const scale = Math.max(1, z.scale);
    // The newest focus keyframe that has started, else the zoom's own point.
    let focus = -1;
    if (z.focus?.length)
      for (let k = z.focus.length - 1; k >= 0; k--)
        if (z.focus[k].t <= t) {
          focus = k;
          break;
        }
    if (z !== currentZoom || focus !== currentFocus) {
      currentZoom = z;
      currentFocus = focus;
      const point = focus >= 0 ? z.focus![focus] : z;
      centerX = point.x;
      centerY = point.y;
    }
    const is3d = (z.mode || s.motionMode) === "3d";
    const pointer =
      hasPointer && z.follow !== false && (s.followCursor || is3d)
        ? smoothPointer(p, t)
        : undefined;
    if (s.followCursor && pointer) {
      const half = FOLLOW_ZONE / scale;
      centerX = clamp(centerX, pointer.x - half, pointer.x + half);
      centerY = clamp(centerY, pointer.y - half, pointer.y + half);
      centerX = clampCenter(centerX, scale);
      centerY = clampCenter(centerY, scale);
    }
    target[LOG_SCALE] = Math.log(scale);
    target[CENTER_X] = clampCenter(centerX, scale);
    target[CENTER_Y] = clampCenter(centerY, scale);
    if (!is3d) return;
    const amount = s.motionIntensity;
    if (pointer) {
      target[TILT_X] = (pointer.y - 0.5) * amount * 1.6;
      target[TILT_Y] = -(pointer.x - 0.5) * amount * 1.6;
    } else {
      target[TILT_X] = z.tiltX ?? -10;
      target[TILT_Y] = z.tiltY ?? 18;
    }
    target[TILT_Z] = z.tiltZ ?? -2;
    target[OFFSET_X] = z.offsetX || 0;
    target[OFFSET_Y] = z.offsetY || 0;
    target[PERSPECTIVE] = z.perspective || 45;
    target[LIFT] = 0.025;
  };

  const segments = playbackSegments(p);
  const total = segments.reduce((n, g) => n + (g.end - g.start) / g.rate, 0);
  const count = Math.max(1, Math.ceil(total * RATE) + 1);
  const samples = new Float32Array(count * CHANNELS);
  let segment = 0,
    segmentOutput = 0;
  const sourceAt = (u: number) => {
    if (!segments.length) return p.trimStart;
    while (segment < segments.length - 1) {
      const g = segments[segment],
        length = (g.end - g.start) / g.rate;
      if (u < segmentOutput + length) break;
      segmentOutput += length;
      segment++;
    }
    const g = segments[segment];
    return Math.min(g.end, g.start + (u - segmentOutput) * g.rate);
  };

  aim(sourceAt(0));
  const springs: Spring[] = Array.from(target, (value) => ({
    value,
    velocity: 0,
  }));
  const dt = 1 / (RATE * SUBSTEPS);
  const response = s.cameraResponse,
    bounce = s.cameraBounce;
  springs.forEach((spring, c) => (samples[c] = spring.value));
  for (let i = 1; i < count; i++) {
    // Aim at the start of each sample interval, so a zoom begins moving exactly
    // at its start time.
    aim(sourceAt((i - 1) / RATE));
    for (let step = 0; step < SUBSTEPS; step++)
      for (let c = 0; c < CHANNELS; c++)
        springStep(springs[c], target[c], response, bounce, dt);
    for (let c = 0; c < CHANNELS; c++)
      samples[i * CHANNELS + c] = springs[c].value;
  }
  return { samples, count };
}

// Cache one path per combination of everything the camera depends on. The
// box is filled lazily so the project itself is not part of the cache key.
const pathBox = memo((..._key: unknown[]) => ({ path: null as Path | null }));

function cameraPath(p: Project) {
  const s = p.settings;
  const box = pathBox(
    autoZooms(p),
    p.points,
    p.demo,
    p.cuts,
    p.speeds,
    p.trimStart,
    p.trimEnd,
    s.speed,
    s.followCursor,
    s.motionMode,
    s.motionIntensity,
    s.cameraResponse,
    s.cameraBounce,
    s.cursorSmoothing,
  );
  box.path ??= buildPath(p);
  return box.path;
}

/** Interpolate every channel at source time t. */
function valuesAt(p: Project, t: number) {
  const { samples, count } = cameraPath(p);
  const f = clamp(outputTimeAt(p, t) * RATE, 0, count - 1),
    i = Math.floor(f),
    n = Math.min(i + 1, count - 1),
    k = f - i;
  const at = (c: number) => {
    const a = samples[i * CHANNELS + c];
    return a + (samples[n * CHANNELS + c] - a) * k;
  };
  return at;
}

/** Camera magnification and view centre at source time t. */
export function cameraAt(p: Project, t: number) {
  const at = valuesAt(p, t);
  return { scale: Math.exp(at(LOG_SCALE)), x: at(CENTER_X), y: at(CENTER_Y) };
}

/** 3D screen pose at source time t. */
export function poseAt(p: Project, t: number): Pose {
  const at = valuesAt(p, t);
  return {
    x: at(TILT_X),
    y: at(TILT_Y),
    z: at(TILT_Z),
    offsetX: at(OFFSET_X),
    offsetY: at(OFFSET_Y),
    perspective: at(PERSPECTIVE),
    scale: 1 + at(LIFT),
  };
}
