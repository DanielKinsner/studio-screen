import { describe, it, expect } from "vitest";
import { newProject } from "./types";
import {
  outputDuration,
  sourceTime,
  outputTimeAt,
  typingSections,
  captionsSrt,
  parseSrt,
} from "./timeline";
import { poseAt } from "./motion";
import { fadeAt, clickEvents } from "./sound";
import { migrateProject } from "./storage";
import { cleanSettings, withCameraFeel } from "./settings";
import { cameraFeel } from "./types";
describe("Edited timing", () => {
  it("maps variable speeds and overlapping cuts in both directions", () => {
    const p = newProject();
    p.trimStart = 2;
    p.trimEnd = 14;
    p.cuts = [
      { id: "a", start: 5, end: 7 },
      { id: "b", start: 6, end: 8 },
    ];
    p.speeds = [{ id: "s", start: 3, end: 10, rate: 2 }];
    expect(outputDuration(p)).toBe(7);
    expect(sourceTime(p, 2)).toBe(8);
    expect(sourceTime(p, 3)).toBe(10);
    expect(outputTimeAt(p, 6)).toBe(2);
    for (let t = 0; t < 7; t += 0.1)
      expect(outputTimeAt(p, sourceTime(p, t))).toBeCloseTo(t, 7);
  });
  it("exports caption timing in edited time, excluding removed footage", () => {
    const p = newProject();
    p.trimEnd = 8;
    p.captions = [{ id: "c", start: 0, end: 8, text: "Read this" }];
    p.cuts = [{ id: "x", start: 2, end: 4 }];
    p.speeds = [{ id: "s", start: 4, end: 8, rate: 2 }];
    expect(parseSrt(captionsSrt(p)).map((c) => [c.start, c.end])).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });
  it("creates typing speedups only from sustained activity within trim", () => {
    const p = newProject();
    p.trimStart = 1;
    p.trimEnd = 5;
    p.points = [0, 0.2, 0.4, 2, 2.4, 2.8, 3.1, 9].map((t) => ({
      t,
      x: 0.5,
      y: 0.5,
      typing: true,
    }));
    expect(typingSections(p).map((s) => [s.start, s.end, s.rate])).toEqual([
      [1.9, 3.5, 2],
    ]);
  });
  it("keeps click sound timestamps aligned with cuts and speed", () => {
    const p = newProject();
    p.points = [
      { t: 2, x: 0.5, y: 0.5, click: true },
      { t: 6, x: 0.5, y: 0.5, click: true },
    ];
    p.demo = false;
    p.trimEnd = 8;
    p.cuts = [{ id: "cut", start: 1, end: 3 }];
    p.settings.speed = 2;
    expect(clickEvents(p)).toEqual([2]);
  });
});
describe("Motion and audio", () => {
  it("returns to an untilted screen at both ends and supports manual tilt without metadata", () => {
    const p = newProject();
    p.demo = false;
    p.settings.autoZoom = false;
    p.zooms = [
      {
        id: "3d",
        start: 1,
        end: 5,
        x: 0.5,
        y: 0.5,
        scale: 1.5,
        mode: "3d",
        follow: false,
        tiltY: 30,
        tiltX: -15,
        tiltZ: 5,
      },
    ];
    expect(poseAt(p, 1).y).toBe(0);
    expect(poseAt(p, 5 + 3 * p.settings.cameraResponse).y).toBeCloseTo(0, 1);
    const middle = poseAt(p, 3);
    expect(middle.x).toBeCloseTo(-15, 1);
    expect(middle.y).toBeCloseTo(30, 1);
    expect(middle.z).toBeCloseTo(5, 1);
  });
  it("fades at edited endpoints, even for shorter videos", () => {
    expect(fadeAt(0, 10, 1)).toBe(0);
    expect(fadeAt(0.5, 10, 1)).toBe(0.5);
    expect(fadeAt(9.5, 10, 1)).toBe(0.5);
    expect(fadeAt(0.5, 1, 2)).toBe(0.25);
    expect(fadeAt(0, 10, 0)).toBe(1);
  });
});
describe("Camera feel settings", () => {
  it("gives older projects the spring that matches their movement style", () => {
    const p = newProject();
    const { cameraResponse, cameraBounce, ...legacy } = p.settings;
    void cameraResponse;
    void cameraBounce;
    const migrated = migrateProject({
      ...p,
      settings: { ...legacy, motionEase: "gentle" } as typeof p.settings,
    });
    expect(migrated.settings.cameraResponse).toBe(cameraFeel.gentle.response);
    expect(migrated.settings.cameraBounce).toBe(cameraFeel.gentle.bounce);
  });
  it("keeps custom spring values that were saved explicitly", () => {
    const p = newProject();
    p.settings = {
      ...p.settings,
      motionEase: "custom",
      cameraResponse: 1.2,
      cameraBounce: 0.2,
    };
    expect(migrateProject(p).settings).toMatchObject({
      motionEase: "custom",
      cameraResponse: 1.2,
      cameraBounce: 0.2,
    });
  });
  it("applies the matching spring when a look only names its movement style", () => {
    expect(withCameraFeel({ motionEase: "focused", padding: 4 })).toEqual({
      motionEase: "focused",
      padding: 4,
      cameraResponse: cameraFeel.focused.response,
      cameraBounce: cameraFeel.focused.bounce,
    });
    expect(
      withCameraFeel({ motionEase: "gentle", cameraResponse: 0.3 }),
    ).toMatchObject({ cameraResponse: 0.3 });
    expect(withCameraFeel({ padding: 4 })).toEqual({ padding: 4 });
  });
  it("clamps imported spring values", () => {
    expect(
      cleanSettings({ cameraResponse: 9, cameraBounce: -1, motionEase: "odd" }),
    ).toEqual({ cameraResponse: 1.5, cameraBounce: 0 });
  });
});
