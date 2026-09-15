// Browser-capture fallback (desktop app with the capture helper switched off).
// Start `npm run dev` first; run while the PC is idle (it records a window and
// plays a test tone). `--region` records a custom area of that window.
//
// Records a real window with system audio, pauses and resumes through the
// floating bar, opens the take with the automatic edit, and exports it to disk.
// Writes tests/<prefix>-capture.webm and tests/<prefix>-export.webm, which
// tests/export-formats.mjs and tests/audio-proof.mjs read.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const regionMode = process.argv.includes("--region");
const prefix = regionMode ? "region" : "native";
if (!process.argv.includes("--force")) {
  const { stdout } = await promisify(execFile)(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "tests/idle.ps1"],
    { windowsHide: true },
  );
  if (+stdout.trim() < 60) {
    console.log(
      `SKIPPED: the PC was used ${(+stdout.trim()).toFixed(0)} s ago. Run when idle, or pass --force.`,
    );
    process.exit(3);
  }
}
// Exports stream straight into this folder with no Save As dialog.
const exportDir = path.join(root, "tests/.exports");
const application = await electron.launch({
  args: [".", "--dev"],
  cwd: root,
  env: {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: "1",
    STUDIO_USER_DATA: path.join(root, "tests/.profile"),
    // Launch-time recovery scans this folder; never point it at real takes.
    STUDIO_PROJECTS_DIR: path.join(root, "tests/.projects"),
    STUDIO_EXPORT_DIR: exportDir,
    // This test covers the browser-capture fallback; native capture has tests/a4.
    STUDIO_DISABLE_NATIVE: "1",
  },
});
try {
  const page = await application.firstWindow();
  await page.getByText("Saved locally", { exact: true }).waitFor();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await application.evaluate(async ({ BrowserWindow }) => {
    const fixture = new BrowserWindow({
      width: 850,
      height: 600,
      title: "Studio Screen Capture Test",
      webPreferences: { backgroundThrottling: false },
    });
    await fixture.loadURL(
      "data:text/html," +
        encodeURIComponent(
          '<!doctype html><title>Studio Screen Capture Test</title><body style="background:#dba482;color:#18372c;font:40px sans-serif;padding:50px"><h1>Studio Screen capture test</h1><p>Real system audio · 440 Hz</p><button id="tone" style="font-size:24px">Play test tone</button><div id="clock"></div><script>setInterval(()=>clock.textContent=new Date().toISOString(),50);tone.onclick=async()=>{const c=new AudioContext();await c.resume();const o=c.createOscillator();const g=c.createGain();g.gain.value=.08;o.frequency.value=440;o.connect(g).connect(c.destination);o.start();window.testAudio=c;};</script></body>',
        ),
    );
  });
  const fixture = application.windows().find((p) => p !== page);
  await fixture.waitForLoadState();
  await fixture.getByRole("button", { name: "Play test tone" }).click();
  await page
    .getByRole("button", { name: "New recording", exact: true })
    .click();
  await page.evaluate(() => window.studioDesktop.sources());
  await page
    .getByRole("button", { name: "Studio Screen Capture Test", exact: true })
    .click();
  if (regionMode) {
    await page
      .getByLabel("Capture area", { exact: true })
      .selectOption("region");
    await page.getByLabel("Capture area width", { exact: true }).fill("50");
    await page.getByLabel("Capture area height", { exact: true }).fill("50");
  }
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  // The editor hides after a countdown; the floating bar controls the take.
  await expect
    .poll(() => application.windows().some((p) => p.url().includes("#bar")), {
      timeout: 30000,
    })
    .toBe(true);
  const bar = application.windows().find((p) => p.url().includes("#bar"));
  await bar.getByRole("button", { name: "Finish" }).waitFor();
  await new Promise((r) => setTimeout(r, 4000));
  await bar
    .getByRole("button", { name: "Pause recording", exact: true })
    .click();
  await new Promise((r) => setTimeout(r, 500));
  await bar
    .getByRole("button", { name: "Resume recording", exact: true })
    .click();
  await new Promise((r) => setTimeout(r, 1300));
  await bar.getByRole("button", { name: "Finish" }).click();
  // Every take of a second or more opens with the automatic edit applied.
  const toast = page.getByRole("status").getByText(/Auto-edit: /);
  await toast.waitFor({ timeout: 20000 });
  const toastText = await toast.innerText();
  await page.getByText("Saved locally", { exact: true }).waitFor();
  const result = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("studio-screen", 1);
      r.onsuccess = () => res(r.result);
      r.onerror = rej;
    });
    const projects = await new Promise((res, rej) => {
      const r = db.transaction("projects").objectStore("projects").getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = rej;
    });
    const p = projects.sort((a, b) => b.updated - a.updated)[0];
    const data = await new Promise((res) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result);
      reader.readAsDataURL(p.video);
    });
    return {
      capture: p.capture,
      showCursor: p.settings.showCursor,
      autoEdited: !!p.autoEdit,
      trimStart: p.trimStart,
      trimEnd: p.trimEnd,
      duration: p.duration,
      videoBytes: p.video.size,
      data,
      points: p.points.length,
      shortcuts: p.points.filter((p) => p.shortcut).map((p) => p.shortcut),
      typingEvents: p.points.filter((p) => p.typing).length,
      clicks: p.points.filter((p) => p.click).length,
    };
  });
  await fs.writeFile(
    path.join(root, `tests/${prefix}-capture.webm`),
    Buffer.from(result.data.split(";base64,")[1], "base64"),
  );
  delete result.data;
  await page.screenshot({
    path: path.join(root, `tests/${prefix}-capture.png`),
  });
  await fs.mkdir(exportDir, { recursive: true });
  const before = new Set(await fs.readdir(exportDir));
  await page.getByRole("button", { name: "Export video", exact: true }).click();
  // WebM keeps tests/audio-proof.mjs comparing like with like.
  await page.getByLabel("Export format").selectOption("webm");
  await page.getByLabel("Export resolution").selectOption("720");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Export video", exact: true })
    .click();
  await page
    .getByText("That’s a wrap.", { exact: true })
    .waitFor({ timeout: 25000 })
    .catch(async (e) => {
      console.log(await page.locator("body").innerText());
      throw e;
    });
  const created = (await fs.readdir(exportDir)).filter((f) => !before.has(f));
  const exportFile = path.join(root, `tests/${prefix}-export.webm`);
  let exportBytes = 0;
  if (created.length === 1 && created[0].endsWith(".webm")) {
    await fs.rename(path.join(exportDir, created[0]), exportFile);
    exportBytes = (await fs.stat(exportFile)).size;
  }
  await fs.writeFile(
    path.join(root, `tests/${prefix}-results.json`),
    JSON.stringify(
      { ...result, toast: toastText, created, exportBytes, errors },
      null,
      2,
    ),
  );
  expect(result.capture).toBe("legacy");
  // The Windows cursor is baked into browser captures, so none is drawn.
  expect(result.showCursor).toBe(false);
  expect(result.duration).toBeGreaterThan(3);
  expect(result.videoBytes).toBeGreaterThan(1000);
  // The fallback records no input for a window: clicks and keys come only from
  // the capture helper (tests/a4-native-capture.mjs), and pointer polling needs
  // a display, which window sources don't have. With no input the automatic
  // edit must keep the whole take and add no zooms.
  expect(result.points).toBe(0);
  expect(result.autoEdited).toBe(true);
  expect(result.trimStart).toBe(0);
  expect(result.trimEnd).toBe(result.duration);
  expect(toastText).toContain("Auto-edit: 0 zooms.");
  // Exactly one finished file, streamed to disk (no leftover .partial).
  expect(created).toEqual([expect.stringMatching(/\.webm$/)]);
  expect(exportBytes).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
  console.log(
    "PASS: real desktop window capture, Windows system audio requested, pause/resume, auto-edit, editor import, export streamed to disk.",
  );
} finally {
  await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await application.close().catch(() => {});
}
