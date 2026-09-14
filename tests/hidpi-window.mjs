import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
const executablePath = process.argv[2];
const app = await electron.launch(
  executablePath ? { executablePath } : { args: ["."], cwd: process.cwd() },
);
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByText("Saved locally", { exact: true }).waitFor();
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMaximized(),
      ),
    )
    .toBe(true);
  const metrics = () =>
    page.getByLabel("Composited video preview").evaluate((c) => {
      const r = c.getBoundingClientRect(),
        ratio = c.width / c.height;
      return {
        width: c.width,
        height: c.height,
        cssWidth: r.width,
        cssHeight: r.height,
        dpr: devicePixelRatio,
        expectedHeight: Math.min(r.height, r.width / ratio) * devicePixelRatio,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
  await expect
    .poll(async () => {
      const m = await metrics();
      return Math.abs(m.height - Math.min(m.expectedHeight, 2160));
    })
    .toBeLessThan(3);
  const maximized = await metrics();
  const display = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0],
      d = screen.getDisplayMatching(w.getBounds());
    return {
      bounds: w.getBounds(),
      workArea: d.workArea,
      nativeWidth: d.size.width * d.scaleFactor,
      nativeHeight: d.size.height * d.scaleFactor,
      scaleFactor: d.scaleFactor,
    };
  });
  expect(maximized.overflow).toBe(false);
  await page.screenshot({ path: "tests/hidpi-window.png" });
  await page
    .getByRole("button", { name: "Preview fullscreen", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  await expect
    .poll(async () => {
      const m = await metrics();
      return Math.abs(m.height - Math.min(m.expectedHeight, 2160));
    })
    .toBeLessThan(3);
  const fullscreen = await metrics();
  expect(fullscreen.width).toBeLessThanOrEqual(3840);
  if (display.nativeHeight >= 2160)
    expect(fullscreen.height).toBeGreaterThan(2000);
  await page.evaluate(() => document.exitFullscreen());
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.unmaximize();
    w.setSize(1100, 800);
  });
  await expect
    .poll(async () => {
      const m = await metrics();
      return m.height < maximized.height;
    })
    .toBe(true);
  const restored = await metrics();
  expect(restored.overflow).toBe(false);
  expect(errors).toEqual([]);
  await fs.writeFile(
    "tests/hidpi-results.json",
    JSON.stringify(
      { display, maximized, fullscreen, restored, errors },
      null,
      2,
    ),
  );
  console.log(
    "PASS native DPI window / fullscreen / resize",
    JSON.stringify({ display, maximized, fullscreen, restored }),
  );
} finally {
  await app.close();
}
