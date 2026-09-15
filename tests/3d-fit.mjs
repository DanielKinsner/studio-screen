// 3D never crops the recording (headless Edge, synthetic input; safe while the
// PC is in use). Start `npm run dev` first.
// Canvas padding 0, a 3D zoom at maximum tilt, rotation and field of view:
// the preview's outer edge must show only background (no card pixels), and
// the card must still fill a good share of the frame. Saves tests/3d-fit.png.
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";

const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1480, height: 980 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByText("Saved locally", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await page.getByLabel("Padding", { exact: true }).fill("0");
  const preview = page.getByLabel("Composited video preview");
  const measure = () => preview.evaluate((canvas) => {
    const { width: w, height: h } = canvas;
    const data = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    // The sample recording is near-white; the Dune background never is.
    const card = (x, y) => {
      const i = (y * w + x) * 4;
      return data[i] > 232 && data[i + 1] > 232 && data[i + 2] > 228;
    };
    let edge = 0,
      inside = 0;
    for (let x = 0; x < w; x++) {
      if (card(x, 0)) edge++;
      if (card(x, h - 1)) edge++;
    }
    for (let y = 0; y < h; y++) {
      if (card(0, y)) edge++;
      if (card(w - 1, y)) edge++;
    }
    for (let y = 0; y < h; y += 4)
      for (let x = 0; x < w; x += 4) if (card(x, y)) inside++;
    return {
      width: w,
      height: h,
      edgeCardPixels: edge,
      cardShare: +(inside / Math.ceil(h / 4) / Math.ceil(w / 4)).toFixed(3),
    };
  });
  // The flat recording at padding 0, for scale.
  const flat = await measure();
  // Dan's case: a default 3D zoom at padding 0.
  await page.getByRole("button", { name: "Focus & 3D", exact: true }).click();
  await page.getByRole("button", { name: "Add 3D zoom", exact: true }).click();
  await page.waitForTimeout(600);
  await preview.screenshot({ path: "tests/3d-fit-default.png" });
  const standard = await measure();
  // The extreme: maximum tilt, rotation and field of view.
  await page.getByLabel("Tilt up / down", { exact: true }).fill("40");
  await page.getByLabel("Tilt left / right", { exact: true }).fill("40");
  await page.getByLabel("Rotation", { exact: true }).fill("30");
  await page.getByText("Position & perspective", { exact: true }).click();
  await page.getByLabel("Field of view", { exact: true }).fill("75");
  await page.waitForTimeout(600);
  await preview.screenshot({ path: "tests/3d-fit.png" });
  const extreme = await measure();
  const result = { flat, standard, extreme };
  await fs.writeFile(
    "tests/3d-fit-results.json",
    JSON.stringify({ ...result, errors }, null, 2),
  );
  console.log(JSON.stringify(result));
  for (const [name, r] of Object.entries({ standard, extreme }))
    check(
      r.edgeCardPixels === 0,
      `The ${name} 3D card is cut off by the frame edge (${r.edgeCardPixels} edge pixels).`,
    );
  check(
    standard.cardShare > flat.cardShare * 0.6,
    `The default 3D card shrank too far (${standard.cardShare} vs flat ${flat.cardShare}).`,
  );
  check(
    extreme.cardShare > flat.cardShare * 0.2,
    `The extreme 3D card shrank too far (${extreme.cardShare} vs flat ${flat.cardShare}).`,
  );
  check(!errors.length, errors.join("\n"));
  console.log(
    "PASS: padding 0 keeps the whole 3D card in frame at the default and maximum tilt.",
  );
} finally {
  await browser.close();
}
