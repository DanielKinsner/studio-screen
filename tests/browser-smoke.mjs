import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:5173");
await page.getByText("Saved locally", { exact: true }).waitFor();
await page.screenshot({ path: "tests/editor-desktop.png", fullPage: true });
await page
  .getByRole("button", { name: "Sage background", exact: true })
  .click();
await page.getByLabel("Padding", { exact: true }).fill("15");
await page.getByRole("button", { name: "Add zoom", exact: true }).click();
await page.getByLabel("Magnification", { exact: true }).fill("2.4");
await page.getByRole("button", { name: "Annotate", exact: true }).click();
await page.getByRole("button", { name: "Text", exact: true }).click();
await page
  .getByLabel("Annotation text", { exact: true })
  .fill("A working screen editor");
await page.getByLabel("Trim end in seconds").fill("3");
await page.getByRole("button", { name: "Play video", exact: true }).click();
await page
  .getByRole("button", { name: "Pause playback", exact: true })
  .waitFor();
await page.getByRole("button", { name: "Pause playback", exact: true }).click();
await page.getByRole("button", { name: "Export video", exact: true }).click();
await page.getByLabel("Export format").selectOption("webm");
await page.getByLabel("Export resolution").selectOption("720");
const downloaded = page.waitForEvent("download");
await page
  .getByRole("dialog")
  .getByRole("button", { name: "Export video", exact: true })
  .click();
const file = await downloaded;
await file.saveAs("tests/sample-export.webm");
await page.getByText("That’s a wrap.", { exact: true }).waitFor();
await page.getByRole("button", { name: "Close dialog", exact: true }).click();
await page.getByText("Saved locally", { exact: true }).waitFor();
await page.reload();
await page.getByText("Saved locally", { exact: true }).waitFor();
if ((await page.getByLabel("Trim end in seconds").inputValue()) !== "3")
  throw new Error("Saved edits did not survive reload");
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: "tests/editor-mobile.png", fullPage: true });
if (
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
)
  throw new Error("Mobile horizontal overflow");
await fs.writeFile(
  "tests/browser-results.json",
  JSON.stringify(
    {
      errors,
      persistence: true,
      exportBytes: (await fs.stat("tests/sample-export.webm")).size,
      mobileOverflow: false,
    },
    null,
    2,
  ),
);
if (errors.length) throw new Error(errors.join("\n"));
await browser.close();
console.log(
  "PASS: editor controls, real WebM export, persistence, mobile viewport, no page errors.",
);
