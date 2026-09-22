import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1480, height: 980 },
  });
  page.on("pageerror", (e) => console.error(e));
  await page.goto("http://127.0.0.1:5173");
  await page.getByText("Saved locally", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Zoom & 3D", exact: true }).click();
  await page.getByRole("button", { name: "Add 3D zoom", exact: true }).click();
  await page.screenshot({ path: "tests/editor-v2.png", fullPage: true });
  await page
    .getByLabel("Composited video preview")
    .screenshot({ path: "tests/3d-preview.png" });
  await page.getByRole("button", { name: "Hero", exact: true }).click();
  await page.getByLabel("Tilt left / right", { exact: true }).fill("30");
  await page.screenshot({ path: "tests/editor-v2-hero.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "tests/editor-v2-mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  console.log("PASS 3D controls and mobile overflow");
} finally {
  await browser.close();
}
