// Editor interactions in the browser editor (synthetic input, headless Edge,
// safe while the PC is in use). Start `npm run dev` first.
//  1. Deselect: empty timeline space, the preview and Esc clear the selection,
//     and Delete then removes nothing.
//  2. Undo: one Ctrl+Z undoes a whole Magnification drag (focus elsewhere or
//     still on the slider), and the edit made before the drag stays undoable.
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

  // 2. One undo step per slider drag, and earlier edits stay undoable.
  const tab = (name) =>
    page.getByRole("button", { name, exact: true }).click();
  await tab("Canvas");
  const padding = page.getByLabel("Padding", { exact: true });
  const paddingBefore = await padding.inputValue();
  await padding.fill("15");
  const magnification = page.getByLabel("Magnification", { exact: true });
  const drag = async (from, to) => {
    const box = await magnification.boundingBox();
    const [min, max] = [1.05, 4];
    const at = (v) => box.x + 8 + ((v - min) / (max - min)) * (box.width - 16);
    const y = box.y + box.height / 2;
    await page.mouse.move(at(from), y);
    await page.mouse.down();
    for (let i = 1; i <= 40; i++)
      await page.mouse.move(at(from + ((to - from) * i) / 40), y);
    await page.mouse.up();
    return +(await magnification.inputValue());
  };
  await select();
  const magnificationBefore = await magnification.inputValue();
  const dragged = await drag(1.65, 2.5);
  check(dragged > 2.3, `The drag only reached ${dragged}×.`);
  // Undo with focus elsewhere (the inspector heading).
  await page.locator(".inspector-heading h1").click();
  await page.keyboard.press("Control+z");
  const afterUndo = await magnification.inputValue();
  check(
    afterUndo === magnificationBefore,
    `One undo after the drag gave ${afterUndo}×, expected ${magnificationBefore}×.`,
  );
  await page.keyboard.press("Control+z");
  await tab("Canvas");
  const paddingAfter = await padding.inputValue();
  check(
    paddingAfter === paddingBefore,
    `The padding edit before the drag was not undoable (${paddingAfter}).`,
  );
  // Undo straight after a drag, with focus still on the slider.
  await select();
  const draggedAgain = await drag(1.65, 2.8);
  await page.keyboard.press("Control+z");
  const focusedUndo = await magnification.inputValue();
  check(
    focusedUndo === magnificationBefore,
    `Ctrl+Z with the slider focused gave ${focusedUndo}×.`,
  );
  results.undo = {
    magnificationBefore: +magnificationBefore,
    dragged,
    afterUndo: +afterUndo,
    paddingBefore: +paddingBefore,
    paddingAfterSecondUndo: +paddingAfter,
    draggedAgain,
    focusedUndo: +focusedUndo,
  };

  check(!errors.length, errors.join("\n"));
  results.errors = errors;
  await fs.writeFile(
    "tests/editor-interactions-results.json",
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results));
  console.log(
    "PASS: empty timeline space, the preview and Esc deselect; Delete then removes nothing. One Ctrl+Z undoes a whole slider drag, earlier edits stay undoable.",
  );
} finally {
  await browser.close();
}
