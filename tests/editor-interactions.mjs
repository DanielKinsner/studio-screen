// Editor interactions in the browser editor (synthetic input, headless Edge,
// safe while the PC is in use). Start `npm run dev` first.
//  1. Deselect: empty timeline space, the preview and Esc clear the selection,
//     and Delete then removes nothing.
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = {};
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
try {
  const page = await browser.newPage({
    viewport: { width: 1480, height: 980 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByText("Saved locally", { exact: true }).waitFor();

  // 1. Deselect.
  const zoomClips = page.locator(".zoom-track .zoom-clip");
  const selectedFocus = page.getByRole("heading", { name: "Selected focus" });
  const zoomCount = await zoomClips.count();
  check(zoomCount > 0, "The sample project has no zoom clips to select.");
  const select = async () => {
    await zoomClips.first().click();
    await selectedFocus.waitFor();
  };
  const deselected = async (how) => {
    await selectedFocus.waitFor({ state: "detached", timeout: 2000 }).catch(() => {
      throw new Error(`${how} did not clear the selection.`);
    });
    await page.keyboard.press("Delete");
    await page.waitForTimeout(150);
    check(
      (await zoomClips.count()) === zoomCount,
      `Delete removed a zoom after ${how} cleared the selection.`,
    );
  };
  const track = await page.locator(".zoom-track").boundingBox();
  await select();
  await page.mouse.click(
    track.x + track.width * 0.97,
    track.y + track.height / 2,
  );
  await deselected("Clicking empty timeline space");
  const playhead = await page
    .locator(".playhead")
    .evaluate((el) => parseFloat(el.style.left));
  check(playhead > 90, `Empty-space press did not scrub (playhead ${playhead}%).`);

  await select();
  await page.keyboard.press("Escape");
  await deselected("Esc");

  await select();
  const preview = await page
    .getByLabel("Composited video preview")
    .boundingBox();
  await page.mouse.click(
    preview.x + preview.width * 0.5,
    preview.y + preview.height * 0.5,
  );
  await deselected("Clicking the preview");
  results.deselect = { zoomCount, playhead: +playhead.toFixed(1) };

  check(!errors.length, errors.join("\n"));
  results.errors = errors;
  await fs.writeFile(
    "tests/editor-interactions-results.json",
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results));
  console.log(
    "PASS: empty timeline space, the preview and Esc deselect; Delete then removes nothing.",
  );
} finally {
  await browser.close();
}
