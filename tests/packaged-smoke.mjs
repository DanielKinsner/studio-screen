// Packaged app smoke test: `release/win-unpacked` by default, or the portable
// EXE with --portable. Nothing here moves the pointer or records the screen.
import { _electron as electron, chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
const { version } = JSON.parse(
  await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const portable = process.argv.includes("--portable");
const executablePath = path.resolve(
  portable
    ? `release/Studio Screen ${version}.exe`
    : "release/win-unpacked/Studio Screen.exe",
);
// A throwaway profile and recordings folder: the smoke test edits a project
// and the app recovers unfinished takes on launch, so it must never see
// Dan's real library or Videos\Studio Screen.
const scratch = path.resolve("tests/.packaged");
await fs.rm(scratch, { recursive: true, force: true });
const env = {
  ...process.env,
  STUDIO_USER_DATA: path.join(scratch, "profile"),
  STUDIO_PROJECTS_DIR: path.join(scratch, "recordings"),
  STUDIO_EXPORT_DIR: path.join(scratch, "exports"),
};

// The portable EXE unpacks itself and starts the real app as a child, which
// Playwright's Electron launcher can't follow; attach over DevTools instead.
let app, browser, child, page;
if (portable) {
  const port = await new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
  child = spawn(executablePath, [`--remote-debugging-port=${port}`], {
    env,
    windowsHide: true,
    stdio: "ignore",
  });
  for (let i = 0; i < 120 && !browser; i++)
    browser = await chromium
      .connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 })
      .catch(() => new Promise((r) => setTimeout(r, 500)).then(() => undefined));
  if (!browser) throw new Error("The portable EXE never opened its window.");
  for (let i = 0; i < 60 && !page; i++) {
    page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => !p.url().includes("#"));
    if (!page) await new Promise((r) => setTimeout(r, 500));
  }
} else {
  app = await electron.launch({ executablePath, timeout: 60000, env });
  page = await app.firstWindow();
}
try {
  await page.getByText("Saved locally", { exact: true }).waitFor();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.getByLabel("Composited video preview")).toBeVisible();
  await expect(page.locator(".app-footer")).toContainText("Desktop studio");
  await expect(page.locator(".app-footer .version")).toHaveText(`v${version}`);
  await page.getByRole("button", { name: "Focus & 3D", exact: true }).click();
  await page.getByRole("button", { name: "Add 3D zoom", exact: true }).click();
  await expect(
    page.getByLabel("Tilt left / right", { exact: true }),
  ).toHaveValue("18");
  await page.screenshot({ path: "tests/packaged-3d.png" });
  await page
    .getByRole("button", { name: "New recording", exact: true })
    .click();
  await expect(
    page.getByRole("switch", { name: "System audio", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("switch", { name: "Microphone (optional)", exact: true }),
  ).toHaveCount(0);
  await page.locator(".source-grid button").first().waitFor();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  // The pointer is on exactly one display: that display's tracker reports it.
  const displayId = app
    ? await app.evaluate(({ screen }) =>
        String(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id),
      )
    : null;
  const pointerProof = await page.evaluate(async (displayId) => {
    const screens = (await window.studioDesktop.sources()).filter(
      (s) => s.id.startsWith("screen:") && (!displayId || s.displayId === displayId),
    );
    for (const source of screens) {
      await window.studioDesktop.selectSource(source.id);
      try {
        const point = await new Promise(async (resolve) => {
          let unsubscribe = () => {};
          const timeout = setTimeout(() => {
            unsubscribe();
            resolve(null);
          }, displayId ? 10000 : 2500);
          unsubscribe = window.studioDesktop.onPoint((pt) => {
            clearTimeout(timeout);
            unsubscribe();
            resolve(pt);
          });
          await window.studioDesktop.track(true);
        });
        if (point) return point;
      } finally {
        await window.studioDesktop.track(false);
      }
    }
    throw new Error("Packaged cursor tracker produced no points.");
  }, displayId);
  await page.screenshot({ path: "tests/packaged-app.png" });
  if (errors.length) throw new Error(errors.join("\n"));
  await fs.writeFile(
    "tests/package-results.json",
    JSON.stringify(
      {
        executablePath,
        url: page.url(),
        version: await page.locator(".app-footer .version").innerText(),
        sourcePicker: true,
        cursorTracker: !!pointerProof,
        systemAudioDefault: true,
        microphoneControlsAbsent: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: packaged app starts, local assets load, native picker works, internal audio default on and mic off.",
  );
} finally {
  if (app) await app.close();
  else {
    await page?.evaluate(() => window.close()).catch(() => {});
    await browser?.close().catch(() => {});
    if (child && child.exitCode === null) child.kill();
  }
}
