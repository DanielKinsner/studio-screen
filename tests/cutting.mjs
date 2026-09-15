// Premiere-style cutting on the sample project (headless Edge, synthetic
// input; safe while the PC is in use). Start `npm run dev` first.
// Ctrl+K splits, Delete leaves a gap that playback skips, Delete on a gap
// closes it (later clips slide left), right-click Restore, Shift+Delete ripple,
// the razor splits, a zoom drag snaps exactly onto a split, and Ctrl+Z undoes
// each of those as one step. Also round-trips splits and ripple cuts through
// a .studio file.
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

  const tracks = await page.locator(".tracks").boundingBox();
  const ruler = await page.locator(".time-ruler").boundingBox();
  const perSecond = tracks.width / 24;
  const x = (t) => tracks.x + t * perSecond;
  const seek = (t) => page.mouse.click(x(t), ruler.y + ruler.height / 2);
  const piecesLocator = page.locator(".screen-piece");
  const gaps = page.locator(".cut-region");
  const markers = page.locator(".ripple-marker");
  const duration = () => page.locator(".timeline-duration").innerText();
  const box = async (locator) => {
    const b = await locator.boundingBox();
    return b && { x: Math.round(b.x), width: Math.round(b.width) };
  };
  const counts = async () => ({
    pieces: await piecesLocator.count(),
    gaps: await gaps.count(),
    markers: await markers.count(),
    duration: await duration(),
  });
  const handZoom = page.locator(".zoom-clip", { hasText: "1.8×" });
  const lastCaption = page.locator(".caption-clip", {
    hasText: "Make room for what matters.",
  });

  // 1. Ctrl+K at two points → three pieces.
  await seek(8);
  await page.keyboard.press("Control+k");
  await seek(17);
  await page.keyboard.press("Control+k");
  await expect(piecesLocator).toHaveCount(3);
  results.split = await counts();

  // A hand zoom over the middle piece.
  await seek(10);
  await page.getByRole("button", { name: "Add zoom", exact: true }).click();
  await expect(handZoom).toHaveCount(1);
  const zoomBefore = await box(handZoom);
  const captionBefore = await box(lastCaption);

  // 2. Delete the middle piece → a hatched gap; output shorter; zoom unchanged.
  await piecesLocator.nth(1).click();
  await page.keyboard.press("Delete");
  await expect(gaps).toHaveCount(1);
  await expect(page.locator(".timeline-duration")).toHaveText("00:15 duration");
  results.gap = { ...(await counts()), zoom: await box(handZoom), zoomBefore };
  expect(results.gap.zoom).toEqual(zoomBefore);

  // 3. Select the gap and Delete → it closes; later clips slide left.
  await gaps.first().click();
  await page.keyboard.press("Delete");
  await expect(gaps).toHaveCount(0);
  await expect(markers).toHaveCount(1);
  const captionAfter = await box(lastCaption);
  results.closed = {
    ...(await counts()),
    captionBefore,
    captionAfter,
    markerTitle: await markers.first().getAttribute("title"),
    handZoomLeft: await handZoom.count(),
  };
  // The timeline fits its (now 15 s) length to the width: the caption that
  // started at 18 s now starts 9 s in.
  expect(
    Math.abs(captionAfter.x - (tracks.x + (9 / 15) * tracks.width)),
  ).toBeLessThan(2);
  expect(captionAfter.x).toBeLessThan(captionBefore.x);
  expect(results.closed.markerTitle).toBe(
    "Removed 9.0 s: right-click to restore",
  );

  // 4. Right-click the marker → Restore footage.
  await markers.first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Restore footage" }).click();
  await expect(markers).toHaveCount(0);
  await expect(piecesLocator).toHaveCount(3);
  results.restored = { ...(await counts()), caption: await box(lastCaption) };
  expect(results.restored.caption).toEqual(captionBefore);

  // 5. Shift+Delete ripple-deletes a piece (then undo it).
  await piecesLocator.first().click();
  await page.keyboard.press("Shift+Delete");
  await expect(markers).toHaveCount(1);
  results.rippleDelete = await counts();
  expect(results.rippleDelete).toMatchObject({
    pieces: 2,
    duration: "00:16 duration",
  });
  await page.keyboard.press("Control+z");
  await expect(markers).toHaveCount(0);
  await expect(piecesLocator).toHaveCount(3);

  // 6. The razor splits where it's clicked.
  await page.keyboard.press("Escape");
  await page.keyboard.press("c");
  await expect(
    page.getByRole("button", { name: "Razor tool (C)" }),
  ).toHaveAttribute("aria-pressed", "true");
  const screen = await page.locator(".screen-track").boundingBox();
  await page.mouse.move(x(2.5), screen.y + screen.height / 2);
  await expect(page.locator(".razor-line")).toHaveCount(1);
  await page.mouse.click(x(2.5), screen.y + screen.height / 2);
  await expect(piecesLocator).toHaveCount(4);
  await page.keyboard.press("v");
  results.razor = await counts();

  // 7. A zoom drag snaps exactly onto the split at 8 s from 5 px away.
  const autoZoom = page.locator(".zoom-clip", { hasText: "1.6×" }).first();
  await autoZoom.click();
  const zoomStart = page.getByLabel("Zoom start", { exact: true });
  const startBefore = +(await zoomStart.inputValue());
  const clip = await autoZoom.boundingBox();
  const grabX = clip.x + clip.width / 2,
    grabY = clip.y + clip.height / 2;
  const dx = (8 - startBefore) * perSecond - 5;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX + dx / 2, grabY, { steps: 5 });
  await page.mouse.move(grabX + dx, grabY, { steps: 5 });
  await expect(page.locator(".snap-line")).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator(".snap-line")).toHaveCount(0);
  results.snap = { startBefore, startAfter: +(await zoomStart.inputValue()) };
  expect(results.snap.startAfter).toBe(8);

  // 8. Undo walks back one action at a time.
  const undo = async (expected, check) => {
    await page.keyboard.press("Control+z");
    if (expected) await expect(piecesLocator).toHaveCount(expected.pieces);
    if (check) await check();
    return counts();
  };
  results.undo = [];
  await autoZoom.focus();
  results.undo.push(
    await undo(null, async () =>
      expect(zoomStart).toHaveValue(String(startBefore)),
    ),
  ); // zoom drag
  results.undo.push(await undo({ pieces: 3 })); // razor split
  results.undo.push(
    await undo(null, () => expect(markers).toHaveCount(1)),
  ); // restore
  results.undo.push(
    await undo(null, async () => {
      await expect(markers).toHaveCount(0);
      await expect(gaps).toHaveCount(1);
    }),
  ); // close gap
  results.undo.push(
    await undo(null, async () => {
      await expect(gaps).toHaveCount(0);
      await expect(piecesLocator).toHaveCount(3);
      await expect(handZoom).toHaveCount(1);
    }),
  ); // delete (gap)
  results.undo.push(
    await undo(null, () => expect(handZoom).toHaveCount(0)),
  ); // add zoom
  results.undo.push(await undo({ pieces: 2 })); // second split
  results.undo.push(await undo({ pieces: 1 })); // first split
  expect(results.undo.at(-1)).toMatchObject({
    pieces: 1,
    gaps: 0,
    markers: 0,
    duration: "00:24 duration",
  });

  // Edge drags: a piece edge pulled inward leaves a gap, Shift makes it a
  // ripple, and the outer grip trims (snapping onto the caption at 1 s).
  await seek(12);
  await page.keyboard.press("Control+k");
  await expect(piecesLocator).toHaveCount(2);
  const drag = async (locator, seconds, shift = false) => {
    const b = await locator.boundingBox();
    const cx = b.x + b.width / 2,
      cy = b.y + b.height / 2;
    await page.mouse.move(cx, cy);
    if (shift) await page.keyboard.down("Shift");
    await page.mouse.down();
    await page.mouse.move(cx + seconds * perSecond, cy, { steps: 8 });
    await page.mouse.up();
    if (shift) await page.keyboard.up("Shift");
  };
  await drag(piecesLocator.nth(0).locator('.piece-edge[data-edge="end"]'), -2);
  await expect(gaps).toHaveCount(1);
  results.edgeGap = await counts();
  await page.keyboard.press("Control+z");
  await expect(gaps).toHaveCount(0);
  await drag(
    piecesLocator.nth(1).locator('.piece-edge[data-edge="start"]'),
    2,
    true,
  );
  await expect(markers).toHaveCount(1);
  results.edgeRipple = await counts();
  await page.keyboard.press("Control+z");
  await expect(markers).toHaveCount(0);
  await drag(page.locator(".screen-clip .clip-grip").first(), 0.9);
  await expect(page.getByLabel("Trim start in seconds")).toHaveValue("1");
  results.trimGrip = await page.getByLabel("Trim start in seconds").inputValue();
  expect(results.edgeGap.duration).toBe("00:22 duration");
  expect(results.edgeRipple.duration).toBe("00:22 duration");

  // 9. Splits and ripple cuts survive a .studio round trip.
  results.roundTrip = await page.evaluate(async () => {
    const { newProject } = await import("/src/types.ts");
    const { projectFile, readProject } = await import("/src/storage.ts");
    const p = newProject();
    p.splits = [4, 12];
    p.cuts = [
      { id: "gap", start: 6, end: 8 },
      { id: "ripple", start: 14, end: 16, ripple: true },
    ];
    const back = await readProject(
      new File([await projectFile(p)], "cuts.studio"),
    );
    return { splits: back.splits, cuts: back.cuts };
  });
  expect(results.roundTrip).toEqual({
    splits: [4, 12],
    cuts: [
      { id: "gap", start: 6, end: 8 },
      { id: "ripple", start: 14, end: 16, ripple: true },
    ],
  });
  results.errors = errors;
  expect(errors).toEqual([]);
} finally {
  await fs.writeFile(
    "tests/cutting-results.json",
    JSON.stringify(results, null, 2),
  );
  await browser.close();
}
console.log(JSON.stringify(results));
console.log(
  "PASS: split, gap, close gap, restore, ripple delete, razor, snapping and one-step undo all work; cuts round-trip through .studio.",
);
