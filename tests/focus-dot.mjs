// Focus dot, aim view and Alt-drag tilt in the browser editor (headless Edge,
// synthetic input; safe while the PC is in use). Start `npm run dev` first.
//  1. A selected zoom shows a dot exactly where the camera maps its focus.
//  2. Dragging the dot opens aim view (zoom area + ghost dots of the other
//     zooms; saves tests/aim-view.png), updates Focus X/Y on release, and one
//     Ctrl+Z restores them.
//  3. The wheel over the dot changes magnification in one undo step.
//  4. Alt+drag tilts a 3D zoom, Alt+wheel changes its field of view, each one
//     undo step; Alt+drag on a 2D zoom explains itself once per session.
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = {};
try {
  const page = await browser.newPage({
    viewport: { width: 1480, height: 980 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByText("Saved locally", { exact: true }).waitFor();
  const saved = async () => {
    await page.waitForTimeout(150);
    await page.getByText("Saved locally", { exact: true }).waitFor();
  };
  const slider = (label) => page.getByLabel(label, { exact: true });
  const dot = page.locator(".focus-dot");
  const centre = async (locator) => {
    const b = await locator.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };

  // 1. The dot sits where the camera maps the focus point.
  await page.getByRole("button", { name: "Add zoom", exact: true }).click();
  await page.getByText("Focus point", { exact: true }).click();
  await slider("Focus X").fill("30");
  await slider("Focus Y").fill("40");
  await saved();
  const expected = await page.evaluate(async () => {
    const { listProjects } = await import("/src/storage.ts");
    const { cardRect } = await import("/src/compositor.ts");
    const { toPreview } = await import("/src/aim.ts");
    const p = (await listProjects()).sort((a, b) => b.updated - a.updated)[0];
    const canvas = document.querySelector(
      'canvas[aria-label="Composited video preview"]',
    );
    const view = {
      width: canvas.width,
      height: canvas.height,
      card: cardRect(canvas.width, canvas.height, p, {}),
    };
    const z = p.zooms.at(-1);
    const pt = toPreview(p, 3, z.x, z.y, view);
    const box = canvas.getBoundingClientRect();
    return {
      x: box.left + (pt.x / canvas.width) * box.width,
      y: box.top + (pt.y / canvas.height) * box.height,
      cardWidth: (view.card.fw / canvas.width) * box.width,
      cardHeight: (view.card.fh / canvas.height) * box.height,
      focus: [z.x, z.y],
    };
  });
  const at = await centre(dot);
  results.dot = { expected, actual: at };
  expect(expected.focus).toEqual([0.3, 0.4]);
  expect(Math.abs(at.x - expected.x)).toBeLessThan(2);
  expect(Math.abs(at.y - expected.y)).toBeLessThan(2);

  // 2. Drag the dot in aim view; one undo restores it.
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 40, at.y + 20, { steps: 4 });
  await page.mouse.move(at.x + 80, at.y + 40, { steps: 4 });
  await expect(page.locator(".aim-area")).toHaveCount(1);
  const ghosts = await page.locator(".ghost-dot").count();
  await page
    .getByLabel("Composited video preview")
    .screenshot({ path: "tests/aim-view.png" });
  await page.mouse.up();
  await expect(page.locator(".aim-area")).toHaveCount(0);
  const aimed = {
    x: +(await slider("Focus X").inputValue()),
    y: +(await slider("Focus Y").inputValue()),
  };
  results.aim = {
    ghosts,
    aimed,
    expected: {
      x: 30 + (80 / expected.cardWidth) * 100,
      y: 40 + (40 / expected.cardHeight) * 100,
    },
  };
  // The sample's other automatic zoom (its click at 5 s now belongs to the
  // hand zoom at 2–5 s, so only the one at 14 s is left).
  expect(ghosts).toBe(1);
  expect(Math.abs(aimed.x - results.aim.expected.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(aimed.y - results.aim.expected.y)).toBeLessThanOrEqual(1);
  await page.keyboard.press("Control+z");
  await expect(slider("Focus X")).toHaveValue("30");
  await expect(slider("Focus Y")).toHaveValue("40");

  // 3. Wheel over the dot: magnification in one undo step.
  const magnification = slider("Magnification");
  const before = await magnification.inputValue();
  for (let i = 0; i < 3; i++) {
    const c = await centre(dot);
    await page.mouse.move(c.x, c.y);
    await page.mouse.wheel(0, -100);
  }
  await expect(magnification).toHaveValue(String(+before + 0.15));
  results.wheel = { before: +before, after: +(await magnification.inputValue()) };
  await page.keyboard.press("Control+z");
  await expect(magnification).toHaveValue(before);

  // 4. Alt+drag tilt and Alt+wheel field of view on a 3D zoom.
  await page.getByRole("button", { name: "Add 3D zoom", exact: true }).click();
  const tiltY = slider("Tilt left / right"),
    tiltX = slider("Tilt up / down");
  await expect(tiltY).toHaveValue("18");
  const preview = await page.getByLabel("Composited video preview").boundingBox();
  const grab = {
    x: preview.x + preview.width * 0.8,
    y: preview.y + preview.height * 0.75,
  };
  await page.mouse.move(grab.x, grab.y);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(grab.x + 20, grab.y - 8, { steps: 4 });
  await page.mouse.move(grab.x + 40, grab.y - 16, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  results.tilt = {
    tiltY: +(await tiltY.inputValue()),
    tiltX: +(await tiltX.inputValue()),
  };
  expect(results.tilt).toEqual({ tiltY: 28, tiltX: -14 });
  await page.keyboard.press("Control+z");
  await expect(tiltY).toHaveValue("18");
  await expect(tiltX).toHaveValue("-10");

  await page.getByText("Position & perspective", { exact: true }).click();
  const fov = slider("Field of view");
  await page.mouse.move(grab.x, grab.y);
  await page.keyboard.down("Alt");
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Alt");
  await expect(fov).toHaveValue("49");
  results.fov = +(await fov.inputValue());
  await page.keyboard.press("Control+z");
  await expect(fov).toHaveValue("45");

  // 2D zoom: Alt+drag explains once, then stays quiet.
  const tracks = await page.locator(".tracks").boundingBox();
  const clip = page.locator(".zoom-clip", { hasText: "2D · 1.8×" });
  const clipBox = await clip.boundingBox();
  await page.mouse.click(clipBox.x + 6, clipBox.y + clipBox.height / 2);
  const toast = page.locator(".toast");
  const altDrag = async () => {
    await page.mouse.move(grab.x, grab.y);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(grab.x + 30, grab.y, { steps: 3 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
  };
  if (await toast.count())
    await page.getByRole("button", { name: "Dismiss notification" }).click();
  await altDrag();
  await expect(toast).toContainText("Switch this zoom to 3D to tilt it.");
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await altDrag();
  await page.waitForTimeout(300);
  results.hintOnce = (await toast.count()) === 0;
  expect(results.hintOnce).toBe(true);
  void tracks;

  results.errors = errors;
  expect(errors).toEqual([]);
} finally {
  await fs.writeFile(
    "tests/focus-dot-results.json",
    JSON.stringify(results, null, 2),
  );
  await browser.close();
}
console.log(JSON.stringify(results));
console.log(
  "PASS: the focus dot sits on the camera's focus, aim view drags it with one undo, the wheel sets magnification, Alt+drag tilts and Alt+wheel sets field of view.",
);
