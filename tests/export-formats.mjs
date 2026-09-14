import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto("http://127.0.0.1:5173");
  await page.getByText("Saved locally", { exact: true }).waitFor();
  // Two consecutive undo operations must each restore a distinct state under React StrictMode.
  await page.getByLabel("Padding", { exact: true }).fill("12");
  await page.getByLabel("Roundness", { exact: true }).fill("20");
  await page
    .getByRole("button", { name: "Undo (Ctrl+Z)", exact: true })
    .click();
  await expect(page.getByLabel("Roundness", { exact: true })).toHaveValue("14");
  await page
    .getByRole("button", { name: "Undo (Ctrl+Z)", exact: true })
    .click();
  await expect(page.getByLabel("Padding", { exact: true })).toHaveValue("8");
  await page
    .getByLabel("Import video or project", { exact: true })
    .setInputFiles("tests/native-capture.webm");
  await page
    .getByText("Video imported. Add a zoom to choose your focus points.", {
      exact: true,
    })
    .waitFor();
  await page.getByLabel("Trim end in seconds").fill("1");
  await page.getByRole("button", { name: "Export video", exact: true }).click();
  const results = [];
  for (const format of ["mp4", "gif"]) {
    await page.getByLabel("Export format").selectOption(format);
    await page.getByLabel("Export resolution").selectOption("720");
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Export video", exact: true })
      .click();
    const download = await downloadPromise;
    await download.saveAs(`tests/format-export.${format}`);
    results.push({
      format,
      bytes: (await fs.stat(`tests/format-export.${format}`)).size,
    });
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Export video", exact: true })
      .click();
  }
  const projectDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const saved = await projectDownload;
  await saved.saveAs("tests/roundtrip.studio");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .getByLabel("Import video or project", { exact: true })
    .setInputFiles("tests/roundtrip.studio");
  await page
    .getByText("Project opened. All edits and media restored.", { exact: true })
    .waitFor();
  await expect(page.getByLabel("Trim end in seconds")).toHaveValue("1");
  await page.getByRole("button", { name: "Play video", exact: true }).click();
  await page
    .getByRole("button", { name: "Pause playback", exact: true })
    .waitFor();
  await fs.writeFile(
    "tests/export-results.json",
    JSON.stringify(
      { formats: results, projectRoundTrip: true, strictModeUndo: true },
      null,
      2,
    ),
  );
  console.log(
    "PASS: MP4, GIF, self-contained project round-trip, imported media playback, consecutive undo.",
  );
} finally {
  await browser.close();
}
