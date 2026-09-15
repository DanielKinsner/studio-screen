import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const { version } = JSON.parse(
  await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const executablePath = path.resolve(
  process.argv.includes("--portable")
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
const app = await electron.launch({ executablePath, timeout: 60000, env });
try {
  const page = await app.firstWindow();
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
  const displayId = await app.evaluate(({ screen }) =>
    String(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id),
  );
  const pointerProof = await page.evaluate(async (displayId) => {
    const sources = await window.studioDesktop.sources();
    const source = sources.find(
      (s) => s.id.startsWith("screen:") && s.displayId === displayId,
    );
    if (!source)
      throw new Error("No display available for cursor tracker test.");
    await window.studioDesktop.selectSource(source.id);
    try {
      return await new Promise(async (resolve, reject) => {
        let unsubscribe = () => {};
        const timeout = setTimeout(() => {
          unsubscribe();
          reject(new Error("Packaged cursor tracker produced no points."));
        }, 10000);
        unsubscribe = window.studioDesktop.onPoint((point) => {
          clearTimeout(timeout);
          unsubscribe();
          resolve(point);
        });
        await window.studioDesktop.track(true);
      });
    } finally {
      await window.studioDesktop.track(false);
    }
  }, displayId);
  await page.screenshot({ path: "tests/packaged-app.png" });
  if (errors.length) throw new Error(errors.join("\n"));
  await fs.writeFile(
    "tests/package-results.json",
    JSON.stringify(
      {
        executablePath,
        url: page.url(),
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
  await app.close();
}
