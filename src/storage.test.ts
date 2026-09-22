import { describe, expect, it } from "vitest";
import { readProject } from "./storage";
import { newProject } from "./types";

/** A .studio file as a hand-edited or foreign file could present it. */
function studioFile(extra: Record<string, unknown>) {
  const p = newProject(false);
  p.duration = 10;
  p.trimEnd = 10;
  const json = JSON.stringify({ ...p, format: "studio-screen", version: 2, ...extra });
  return new File([json], "take.studio", { type: "application/json" });
}

describe("importing a .studio file", () => {
  it("never keeps a disk folder, so autosave can't write into another take", async () => {
    const p = await readProject(
      studioFile({ folder: "C:\\Users\\me\\Videos\\Studio Screen\\2026-09-20 14.02.11" }),
    );
    expect(p.folder).toBeUndefined();
  });

  it("never keeps a link to another take's video", async () => {
    const p = await readProject(
      studioFile({ videoUrl: "studio-media://take/2026-09-20 14.02.11/recording.mp4" }),
    );
    expect(p.videoUrl).toBeUndefined();
  });

  it("still opens an ordinary project", async () => {
    const p = await readProject(studioFile({ name: "Tutorial" }));
    expect(p.name).toBe("Tutorial");
    expect(p.duration).toBe(10);
  });
});
