import { cleanSettings } from "./settings";
import type { Project } from "./types";
import { cameraFeel, defaults } from "./types";
export function migrateProject(p: Project): Project {
  const saved = cleanSettings(p.settings);
  // Footage captured before the capture helper has the Windows cursor baked
  // in, so the drawn cursor starts off to avoid showing two.
  const legacy = !p.capture && !p.demo && !!(p.video || p.videoUrl);
  if (legacy) saved.showCursor = false;
  // Projects saved before the spring camera only know their movement style.
  const feel =
    cameraFeel[saved.motionEase as keyof typeof cameraFeel] ??
    cameraFeel.smooth;
  return {
    ...p,
    settings: {
      ...defaults,
      cameraResponse: feel.response,
      cameraBounce: feel.bounce,
      ...saved,
    },
    capture: legacy ? "legacy" : p.capture,
    speeds: p.speeds || [],
    splits: Array.isArray(p.splits)
      ? [...new Set(p.splits.filter(Number.isFinite))].sort((a, b) => a - b)
      : [],
    hiddenCursor: p.hiddenCursor || [],
    dismissedZooms: p.dismissedZooms || [],
  };
}
const database = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("studio-screen", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("projects", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
async function operation<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("projects", mode);
    const request = run(tx.objectStore("projects"));
    tx.oncomplete = () => {
      resolve(request.result);
      db.close();
    };
    tx.onerror = () => {
      reject(tx.error);
      db.close();
    };
    tx.onabort = () => {
      reject(tx.error);
      db.close();
    };
  });
}
export const saveProject = (p: Project) =>
  operation("readwrite", (s) => s.put({ ...p, updated: Date.now() }));
export const listProjects = async () =>
  (await operation<Project[]>("readonly", (s) => s.getAll())).map(
    migrateProject,
  );
export const deleteProject = (id: string) =>
  operation("readwrite", (s) => s.delete(id));
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function projectFile(p: Project) {
  const encoded: Record<string, unknown> = {
    ...p,
    format: "studio-screen",
    version: 2,
  };
  // A recording streamed from disk travels inside the file like any other.
  const media = {
    ...p,
    video:
      p.video ??
      (p.videoUrl ? await (await fetch(p.videoUrl)).blob() : undefined),
  };
  delete encoded.videoUrl;
  delete encoded.folder;
  for (const key of ["video", "camera", "music", "backgroundImage"] as const) {
    if (media[key])
      encoded[key] = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = rej;
        r.readAsDataURL(
          new Blob([media[key]!], { type: media[key]!.type.split(";")[0] }),
        );
      });
  }
  return new Blob([JSON.stringify(encoded)], { type: "application/json" });
}
export async function readProject(file: File): Promise<Project> {
  const p = JSON.parse(await file.text());
  if (
    p.format !== "studio-screen" ||
    ![1, 2].includes(p.version) ||
    !p.settings ||
    !Number.isFinite(p.duration) ||
    p.duration <= 0 ||
    !Array.isArray(p.cuts) ||
    !Array.isArray(p.zooms) ||
    !Array.isArray(p.captions) ||
    !Array.isArray(p.annotations) ||
    !Array.isArray(p.points)
  )
    throw new Error("This is not a supported Studio Screen project.");
  if (
    !(p.settings.speed > 0 && p.settings.speed <= 4) ||
    !Number.isFinite(p.trimStart) ||
    !Number.isFinite(p.trimEnd) ||
    p.trimStart < 0 ||
    p.trimEnd > p.duration ||
    p.trimEnd <= p.trimStart
  )
    throw new Error("The project contains invalid timing.");
  for (const key of ["speeds", "hiddenCursor", "dismissedZooms"])
    if (p[key] !== undefined && !Array.isArray(p[key]))
      throw new Error("Invalid editing data.");
  for (const key of [
    "zooms",
    "cuts",
    "captions",
    "annotations",
    "speeds",
    "hiddenCursor",
  ])
    for (const item of p[key] || []) {
      if (
        typeof item.id !== "string" ||
        !Number.isFinite(item.start) ||
        !Number.isFinite(item.end) ||
        item.start < 0 ||
        item.end <= item.start
      )
        throw new Error("Invalid edit timing.");
    }
  for (const speed of p.speeds || [])
    if (!Number.isFinite(speed.rate) || speed.rate < 0.5 || speed.rate > 4)
      throw new Error("Invalid speed section.");
  for (const cut of p.cuts)
    if (cut.ripple !== undefined && typeof cut.ripple !== "boolean")
      throw new Error("Invalid cut.");
  if (
    p.splits !== undefined &&
    (!Array.isArray(p.splits) ||
      p.splits.some((t: unknown) => !Number.isFinite(t)))
  )
    throw new Error("Invalid split points.");
  for (const z of p.zooms) {
    for (const key of ["x", "y", "scale"])
      if (!Number.isFinite(z[key])) throw new Error("Invalid focus point.");
    z.x = Math.max(0, Math.min(1, z.x));
    z.y = Math.max(0, Math.min(1, z.y));
    z.scale = Math.max(1, Math.min(4, z.scale));
    if (z.focus !== undefined) {
      if (
        !Array.isArray(z.focus) ||
        z.focus.some(
          (f: Partial<Record<"t" | "x" | "y", unknown>> | null) =>
            !f ||
            !Number.isFinite(f.t) ||
            !Number.isFinite(f.x) ||
            !Number.isFinite(f.y),
        )
      )
        throw new Error("Invalid focus point.");
      z.focus = z.focus.map(
        (f: { t: number; x: number; y: number; click?: unknown }) => ({
          t: f.t,
          x: Math.max(0, Math.min(1, f.x)),
          y: Math.max(0, Math.min(1, f.y)),
          ...(Number.isFinite(f.click) ? { click: f.click as number } : {}),
        }),
      );
    }
    for (const [key, min, max] of [
      ["tiltX", -40, 40],
      ["tiltY", -40, 40],
      ["tiltZ", -30, 30],
      ["offsetX", -60, 60],
      ["offsetY", -60, 60],
      ["perspective", 25, 75],
    ] as const) {
      if (z[key] !== undefined) {
        if (!Number.isFinite(z[key])) throw new Error("Invalid 3D angle.");
        z[key] = Math.max(min, Math.min(max, z[key]));
      }
    }
  }
  for (const key of ["video", "camera", "music", "backgroundImage"]) {
    if (p[key]) {
      if (typeof p[key] !== "string" || !p[key].startsWith("data:"))
        throw new Error("Invalid embedded media.");
      p[key] = await (await fetch(p[key])).blob();
    }
  }
  p.id = crypto.randomUUID();
  return migrateProject(p);
}
