// Export asks where to save (desktop app, Electron Playwright with synthetic
// input; safe while the PC is in use). Start `npm run dev` first.
// The Save As dialog and "Show in folder" are stubbed inside the main process,
// and the test profile starts in a throwaway folder, so no real dialog opens
// and nothing is written to Videos\Studio Screen.
//  1. Save As → the file lands where chosen, replacing an existing file only
//     on success; Show in folder is allowed; the folder is remembered.
//  2. Cancelling Save As ends quietly: no file, no error, dialog ready.
//  3. Ctrl+E saves next to the last export with no dialog.
//  4. A failed export leaves a pre-existing file at that path untouched.
import { _electron as electron, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);
const root = process.cwd();
const ffmpeg =
  process.env.FFMPEG_PATH ||
  "C:/Program Files (x86)/Common Files/AutoPod/ffmpeg/bin/ffmpeg.exe";
const source = "tests/export-source.mp4";
if (!existsSync(source))
  await run(ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=30:duration=3",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=3",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    source,
  ]);

const base = path.join(root, "tests/.export-location");
const startDir = path.join(base, "start");
const chosenDir = path.join(base, "chosen");
const profile = path.join(root, "tests/.profile-export");
await fs.rm(base, { recursive: true, force: true });
await fs.rm(profile, { recursive: true, force: true });
await fs.mkdir(startDir, { recursive: true });
await fs.mkdir(chosenDir, { recursive: true });
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, "export-state.json"),
  JSON.stringify({ lastDir: startDir }),
);
const env = { ...process.env, STUDIO_USER_DATA: profile };
delete env.STUDIO_EXPORT_DIR;

const results = {};
const app = await electron.launch({ args: [".", "--dev"], cwd: root, env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByText("Saved locally", { exact: true }).waitFor();
  await page.evaluate(async () => {
    const { newProject } = await import("/src/types.ts");
    const { saveProject } = await import("/src/storage.ts");
    const p = newProject(false);
    p.name = "Export location test";
    p.video = await (await fetch("/tests/export-source.mp4")).blob();
    p.duration = 3;
    p.trimEnd = 3;
    p.settings.autoZoom = false;
    p.updated = Date.now() + 60000;
    await saveProject(p);
  });
  await page.reload();
  await page.getByText("Export location test", { exact: true }).waitFor();
  await page.getByText("Saved locally", { exact: true }).waitFor();

  await app.evaluate(({ dialog, shell }) => {
    globalThis.__exportTest = { dialogs: [], reveals: [], answer: null };
    dialog.showSaveDialog = async (_window, options) => {
      globalThis.__exportTest.dialogs.push(options);
      return globalThis.__exportTest.answer;
    };
    shell.showItemInFolder = (file) => globalThis.__exportTest.reveals.push(file);
  });
  const answer = (value) =>
    app.evaluate((_, v) => {
      globalThis.__exportTest.answer = v;
    }, value);
  const calls = () => app.evaluate(() => globalThis.__exportTest);
  const dialog = page.getByRole("dialog");
  const toast = page.locator(".toast");
  const dismissToast = async () => {
    if (await toast.count())
      await page
        .getByRole("button", { name: "Dismiss notification", exact: true })
        .click();
    await expect(toast).toHaveCount(0);
  };
  const listing = async () => (await fs.readdir(chosenDir)).sort();

  // 1. Save As, replacing an existing file on success.
  const chosen = path.join(chosenDir, "Chosen name.mp4");
  await fs.writeFile(chosen, "ORIGINAL");
  await answer({ canceled: false, filePath: chosen });
  await page.getByRole("button", { name: "Export video", exact: true }).click();
  await dialog.getByLabel("Export format").selectOption("mp4");
  await dialog.getByLabel("Export resolution").selectOption("720");
  await dialog.getByLabel("Export frame rate").selectOption("30");
  await dialog.getByRole("button", { name: "Export video", exact: true }).click();
  await dialog
    .getByText("That’s a wrap.", { exact: true })
    .waitFor({ timeout: 60000 });
  const saved = await fs.readFile(chosen);
  const state = JSON.parse(
    await fs.readFile(path.join(profile, "export-state.json"), "utf8"),
  );
  let c = await calls();
  results.saveAs = {
    dialogs: c.dialogs.length,
    defaultPath: c.dialogs[0]?.defaultPath,
    filters: c.dialogs[0]?.filters,
    bytes: saved.length,
    isMp4: saved.subarray(4, 8).toString() === "ftyp",
    files: await listing(),
    lastDir: state.lastDir,
    toast: await toast.innerText(),
    subtitle: await dialog.locator(".modal-heading p").innerText(),
  };
  await dialog.getByRole("button", { name: "Show in folder", exact: true }).click();
  await page.waitForTimeout(300);
  results.saveAs.revealed = (await calls()).reveals;
  expect(results.saveAs.dialogs).toBe(1);
  expect(path.dirname(results.saveAs.defaultPath)).toBe(startDir);
  expect(results.saveAs.filters).toEqual([
    { name: "MP4 video", extensions: ["mp4"] },
  ]);
  expect(results.saveAs.isMp4).toBe(true);
  expect(results.saveAs.bytes).toBeGreaterThan(10000);
  expect(results.saveAs.files).toEqual(["Chosen name.mp4"]);
  expect(results.saveAs.lastDir).toBe(chosenDir);
  expect(results.saveAs.toast).toContain("Export complete. Saved to chosen.");
  expect(results.saveAs.subtitle).toBe("Saved to chosen.");
  expect(results.saveAs.revealed).toEqual([chosen]);

  // 2. Cancel Save As.
  await dismissToast();
  await answer({ canceled: true, filePath: "" });
  await dialog.getByRole("button", { name: "Export again", exact: true }).click();
  await expect
    .poll(async () => (await calls()).dialogs.length)
    .toBe(2);
  await page.waitForTimeout(500);
  results.cancel = {
    files: await listing(),
    toasts: await toast.count(),
    progress: await dialog.getByRole("progressbar").count(),
    exportButton: await dialog
      .getByRole("button", { name: "Export video", exact: true })
      .isEnabled(),
  };
  expect(results.cancel).toEqual({
    files: ["Chosen name.mp4"],
    toasts: 0,
    progress: 0,
    exportButton: true,
  });

  // 3. Ctrl+E: next to the last export, no dialog.
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("Control+e");
  await dialog
    .getByText("That’s a wrap.", { exact: true })
    .waitFor({ timeout: 60000 });
  c = await calls();
  results.quick = {
    dialogs: c.dialogs.length,
    files: await listing(),
    toast: await toast.innerText(),
  };
  expect(results.quick.dialogs).toBe(2);
  expect(results.quick.files).toEqual([
    "Chosen name.mp4",
    "Export location test.mp4",
  ]);
  expect(results.quick.toast).toContain("Saved to chosen.");

  // 4. A failed export never touches the file it would have replaced.
  await dismissToast();
  const keep = path.join(chosenDir, "Keep me.mp4");
  await fs.writeFile(keep, "KEEP ME");
  await answer({ canceled: false, filePath: keep });
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("studio:export-write");
    ipcMain.handle("studio:export-write", () => {
      throw new Error("Simulated disk failure");
    });
  });
  await dialog.getByRole("button", { name: "Export again", exact: true }).click();
  await toast.waitFor({ timeout: 60000 });
  await expect(
    dialog.getByRole("button", { name: "Export video", exact: true }),
  ).toBeEnabled({ timeout: 60000 });
  await page.waitForTimeout(500);
  results.failure = {
    toast: await toast.innerText(),
    kept: await fs.readFile(keep, "utf8"),
    files: await listing(),
  };
  expect(results.failure.toast).toContain("Simulated disk failure");
  expect(results.failure.kept).toBe("KEEP ME");
  expect(results.failure.files).toEqual([
    "Chosen name.mp4",
    "Export location test.mp4",
    "Keep me.mp4",
  ]);

  // 5. An unreadable remembered folder falls back to Videos\Studio Screen\
  //    Exports (the dialog is cancelled, so nothing is written there).
  await dismissToast();
  await fs.writeFile(path.join(profile, "export-state.json"), "{not json");
  await answer({ canceled: true, filePath: "" });
  const before = (await calls()).dialogs.length;
  await dialog.getByRole("button", { name: "Export video", exact: true }).click();
  await expect
    .poll(async () => (await calls()).dialogs.length)
    .toBe(before + 1);
  const fallback = path.join(
    await app.evaluate(({ app }) => app.getPath("videos")),
    "Studio Screen",
    "Exports",
  );
  results.fallback = {
    defaultDir: path.dirname((await calls()).dialogs[before].defaultPath),
    expected: fallback,
  };
  expect(results.fallback.defaultDir).toBe(fallback);
  results.errors = errors;
  expect(errors).toEqual([]);
} finally {
  await fs.writeFile(
    path.join(root, "tests/export-location-results.json"),
    JSON.stringify(results, null, 2),
  );
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close().catch(() => {});
}
console.log(JSON.stringify(results, null, 2));
console.log(
  "PASS: Save As saves where chosen and remembers the folder, cancel is quiet, Ctrl+E skips the dialog, failures never touch existing files.",
);
