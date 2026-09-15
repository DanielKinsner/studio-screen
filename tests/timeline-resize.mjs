// The timeline can be dragged taller (headless Edge, synthetic input; safe
// while the PC is in use). Start `npm run dev` first.
// At 1920×1080 and 1366×768: dragging the handle up 200 px makes the timeline
// and its rows taller (up to 70% of the editor) and the preview smaller
// without overflowing; the height survives a reload; double-click resets.
// Saves tests/timeline-resize-1920.png and tests/timeline-resize-1366.png.
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";

const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const results = {};
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const [width, height] of [
    [1920, 1080],
    [1366, 768],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:5173");
    await page.getByText("Saved locally", { exact: true }).waitFor();
    const measure = () =>
      page.evaluate(() => {
        const box = (selector) =>
          document.querySelector(selector).getBoundingClientRect();
        const canvas = box('canvas[aria-label="Composited video preview"]');
        return {
          section: Math.round(box(".timeline-section").height),
          editor: Math.round(box(".editor").height),
          zoomRow: Math.round(box(".zoom-track").height * 10) / 10,
          zoomLabel: Math.round(box(".track-labels > span:nth-child(3)").height * 10) / 10,
          zoomClip: Math.round(box(".zoom-clip").height * 10) / 10,
          screenRow: Math.round(box(".screen-track").height * 10) / 10,
          preview: Math.round(canvas.height),
          previewBottom: Math.round(canvas.bottom),
          playbackTop: Math.round(box(".playback-bar").top),
          overflowX: document.documentElement.scrollWidth > innerWidth,
        };
      });
    await page.waitForTimeout(300);
    const before = await measure();
    // The resting timeline looks exactly as it did before it could resize.
    check(
      before.section === 278 &&
        before.screenRow === 44 &&
        before.zoomRow === 29 &&
        before.zoomLabel === 29 &&
        before.zoomClip === 22,
      `${width}: resting timeline changed (${JSON.stringify(before)}).`,
    );
    const handle = page.getByRole("separator", { name: "Resize timeline" });
    const h = await handle.boundingBox();
    check(!!h, "No timeline resize handle.");
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++)
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 - i * 10);
    await page.mouse.up();
    await page.waitForTimeout(400);
    const dragged = await measure();
    await page.screenshot({
      path: `tests/timeline-resize-${width}.png`,
    });
    const expected = Math.min(
      before.section + 200,
      Math.round(before.editor * 0.7),
    );
    check(
      Math.abs(dragged.section - expected) <= 2,
      `${width}: timeline is ${dragged.section}px after dragging, expected ${expected}px.`,
    );
    check(
      dragged.zoomRow > before.zoomRow + 10 &&
        Math.abs(dragged.zoomLabel - dragged.zoomRow) < 1.5 &&
        dragged.zoomClip > before.zoomClip,
      `${width}: rows did not grow with the timeline (${JSON.stringify({ before, dragged })}).`,
    );
    check(
      dragged.preview < before.preview &&
        dragged.previewBottom <= dragged.playbackTop + 1 &&
        !dragged.overflowX,
      `${width}: the preview did not shrink cleanly (${JSON.stringify({ before, dragged })}).`,
    );
    await page.getByText("Saved locally", { exact: true }).waitFor();
    await page.reload();
    await page.getByText("Saved locally", { exact: true }).waitFor();
    await page.waitForTimeout(300);
    const reloaded = await measure();
    check(
      Math.abs(reloaded.section - dragged.section) <= 1,
      `${width}: height not kept after reload (${reloaded.section} vs ${dragged.section}).`,
    );
    const again = await handle.boundingBox();
    await page.mouse.dblclick(again.x + again.width / 2, again.y + again.height / 2);
    await page.waitForTimeout(300);
    const reset = await measure();
    check(
      reset.section === before.section && reset.zoomRow === before.zoomRow,
      `${width}: double-click did not reset (${reset.section}px, row ${reset.zoomRow}).`,
    );
    check(!errors.length, errors.join("\n"));
    results[`${width}x${height}`] = { before, dragged, reloaded, reset };
    await context.close();
  }
  await fs.writeFile(
    "tests/timeline-resize-results.json",
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results));
  console.log(
    "PASS: dragging the timeline taller grows its rows and shrinks the preview; kept after reload; double-click resets.",
  );
} finally {
  await browser.close();
}
