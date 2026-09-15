import { describe, expect, it } from "vitest";
import { cameraAt, poseAt } from "./camera";
import { autoZooms, clampCenter, outputTimeAt } from "./timeline";
import { cameraFeel, newProject, type Project, type Zoom } from "./types";

function project(zooms: Zoom[], duration = 12): Project {
  const p = newProject(false);
  p.duration = duration;
  p.trimEnd = duration;
  p.settings.autoZoom = false;
  p.settings.followCursor = false;
  p.zooms = zooms;
  return p;
}
const zoom = (value: Partial<Zoom>): Zoom => ({
  id: crypto.randomUUID(),
  start: 1,
  end: 5,
  x: 0.5,
  y: 0.5,
  scale: 2,
  mode: "2d",
  ...value,
});
const frames = (from: number, to: number) =>
  Array.from(
    { length: Math.round((to - from) * 60) + 1 },
    (_, i) => from + i / 60,
  );

describe("Spring camera", () => {
  it("stays zoomed between two zooms that are close together", () => {
    const p = project([
      zoom({ start: 1, end: 3, x: 0.3 }),
      zoom({ start: 3.8, end: 6, x: 0.7 }),
    ]);
    for (const t of frames(2, 5))
      expect(cameraAt(p, t).scale).toBeGreaterThan(1.6);
  });
  it("glides to each click inside an automatic zoom", () => {
    const p = newProject(false);
    p.duration = 12;
    p.trimEnd = 12;
    p.settings.followCursor = false;
    p.points = [
      { t: 0, x: 0.5, y: 0.5 },
      { t: 3, x: 0.2, y: 0.2, click: true },
      { t: 4.5, x: 0.8, y: 0.8, click: true },
      { t: 12, x: 0.8, y: 0.8 },
    ];
    const scale = p.settings.zoomStrength;
    const early = cameraAt(p, 3.3);
    expect(early.x).toBeLessThan(0.45);
    const late = cameraAt(p, 6);
    expect(late.scale).toBeCloseTo(scale, 2);
    expect(Math.abs(late.x - clampCenter(0.8, scale))).toBeLessThan(0.02);
    expect(Math.abs(late.y - clampCenter(0.8, scale))).toBeLessThan(0.02);
  });
  it("shows the same camera whether you scrub or play", () => {
    const zooms = [
      zoom({ start: 1, end: 3, x: 0.2, y: 0.8 }),
      zoom({ start: 4, end: 9, x: 0.9, y: 0.1, scale: 2.5, mode: "3d" }),
    ];
    const played = project(zooms);
    const times = Array.from({ length: 600 }, (_, i) => (i * 12) / 600);
    const ascending = times.map((t) => [
      cameraAt(played, t),
      poseAt(played, t),
    ]);
    const scrubbed = project(zooms.map((z) => ({ ...z })));
    const order = [...times.keys()].sort(
      (a, b) => ((a * 7919) % 600) - ((b * 7919) % 600),
    );
    for (const i of order)
      expect([
        cameraAt(scrubbed, times[i]),
        poseAt(scrubbed, times[i]),
      ]).toEqual(ascending[i]);
  });
  it("moves without jumps", () => {
    const p = project([
      zoom({ start: 1, end: 4, x: 0.1, y: 0.1, scale: 1.8 }),
      zoom({ start: 4.2, end: 7, x: 0.9, y: 0.9, scale: 1.8 }),
    ]);
    const scales = frames(0, 11).map((t) => cameraAt(p, t).scale);
    for (let i = 1; i < scales.length; i++)
      expect(Math.abs(scales[i] - scales[i - 1])).toBeLessThan(0.08);
    for (let i = 1; i < scales.length - 1; i++)
      expect(
        Math.abs(scales[i + 1] - 2 * scales[i] + scales[i - 1]),
      ).toBeLessThan(0.03);
  });
  it("settles back to the full frame after a zoom ends", () => {
    const p = project([zoom({ start: 1, end: 4 })]);
    const response = p.settings.cameraResponse;
    expect(cameraAt(p, 4 + 3 * response).scale).toBeCloseTo(1, 2);
    expect(cameraAt(p, 0.5).scale).toBe(1);
  });
  it("keeps a wandering cursor in view when following is on", () => {
    const p = project([zoom({ start: 1, end: 10 })]);
    p.settings.followCursor = true;
    p.points = [
      { t: 0, x: 0.5, y: 0.5 },
      { t: 3, x: 0.9, y: 0.5 },
      { t: 10, x: 0.9, y: 0.5 },
    ];
    const at = cameraAt(p, 7);
    expect(0.9 - at.x).toBeLessThanOrEqual(0.3 / 2 + 0.01);
    expect(cameraAt(p, 2).x).toBeGreaterThan(0.5);
  });
  it("heads for the next click early even before the pointer travels there", () => {
    const p = newProject(false);
    p.duration = 12;
    p.trimEnd = 12;
    Object.assign(p.settings, {
      motionEase: "focused",
      cameraResponse: cameraFeel.focused.response,
      cameraBounce: cameraFeel.focused.bounce,
      followCursor: true,
    });
    // Click top-left, then bottom-right 0.6 s later; the pointer only travels
    // in the last 0.2 s.
    p.points = [
      { t: 0, x: 0.1, y: 0.1 },
      { t: 2, x: 0.1, y: 0.1, click: true },
      { t: 2.4, x: 0.1, y: 0.1 },
      { t: 2.6, x: 0.9, y: 0.9, click: true },
      { t: 12, x: 0.9, y: 0.9 },
    ];
    const [z] = autoZooms(p);
    expect(z.focus).toHaveLength(2);
    const key = z.focus![1].t;
    expect(key).toBeLessThan(2.6);
    const scale = z.scale;
    const from = cameraAt(p, key).x,
      target = clampCenter(0.9, scale);
    expect(cameraAt(p, key + 1 / 30).x).toBeGreaterThan(from + 1e-4);
    expect(cameraAt(p, 2.6).x - from).toBeGreaterThanOrEqual(
      0.7 * (target - from),
    );
  });
  it("opens on the neutral pose even when a zoom starts at the trim start", () => {
    for (const trimStart of [0, 2]) {
      const p = project([
        zoom({
          start: trimStart,
          end: trimStart + 4,
          x: 0.2,
          y: 0.8,
          scale: 2.5,
          mode: "3d",
          follow: false,
          tiltX: -15,
          tiltY: 30,
          tiltZ: 5,
          offsetX: 10,
        }),
      ]);
      p.trimStart = trimStart;
      expect(cameraAt(p, trimStart)).toEqual({ scale: 1, x: 0.5, y: 0.5 });
      expect(poseAt(p, trimStart)).toEqual({
        x: 0,
        y: 0,
        z: 0,
        offsetX: 0,
        offsetY: 0,
        perspective: 45,
        scale: 1,
      });
      expect(cameraAt(p, trimStart + 2).scale).toBeGreaterThan(2.3);
    }
  });
  it("tilts a manual 3D zoom from flat to its chosen angle and back", () => {
    const p = project([
      zoom({
        start: 1,
        end: 5,
        scale: 1.5,
        mode: "3d",
        follow: false,
        tiltX: -15,
        tiltY: 30,
        tiltZ: 5,
      }),
    ]);
    expect(poseAt(p, 1).y).toBe(0);
    const middle = poseAt(p, 3);
    expect(middle.x).toBeCloseTo(-15, 1);
    expect(middle.y).toBeCloseTo(30, 1);
    expect(middle.z).toBeCloseTo(5, 1);
    expect(poseAt(p, 5 + 3 * p.settings.cameraResponse).y).toBeCloseTo(0, 1);
  });
  it("keeps zoom timing the same in the edit when footage is sped up", () => {
    const rise = (p: Project) => {
      const start = outputTimeAt(p, 2);
      for (let u = start; u < start + 3; u += 1 / 240) {
        // Find the source time for this output time by bisection on outputTimeAt.
        let lo = 0,
          hi = p.duration;
        for (let k = 0; k < 40; k++) {
          const mid = (lo + hi) / 2;
          if (outputTimeAt(p, mid) < u) lo = mid;
          else hi = mid;
        }
        if (Math.log(cameraAt(p, hi).scale) >= 0.9 * Math.log(2))
          return u - start;
      }
      return Infinity;
    };
    const normal = project([zoom({ start: 2, end: 9 })]);
    const fast = project([zoom({ start: 2, end: 9 })]);
    fast.speeds = [{ id: "fast", start: 1, end: 11, rate: 2 }];
    expect(Math.abs(rise(normal) - rise(fast))).toBeLessThan(1 / 60);
  });
});
