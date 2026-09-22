// A PC that can't encode the export's audio must say so, not hand back a
// silent video. Pretends the browser has no AAC encoder, turns on click sounds
// (so the export has audio to write) and exports an MP4.
// Needs `npm run dev`; headless, never touches the screen.
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  if (typeof AudioEncoder !== "undefined")
    AudioEncoder.isConfigSupported = async (config) => ({ supported: false, config });
});
let downloaded = false;
page.on("download", () => (downloaded = true));
try {
  await page.goto("http://127.0.0.1:5173");
  await page.getByText("Saved locally", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByLabel("Click sound volume", { exact: true }).fill("30");
  await page.getByRole("button", { name: "Export video", exact: true }).click();
  await page.getByLabel("Export format").selectOption("mp4");
  await page.getByLabel("Export resolution").selectOption("720");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Export video", exact: true })
    .click();
  const warned = page.getByText(/can't encode AAC audio/);
  const finished = page.getByText("That’s a wrap.", { exact: true });
  await Promise.race([
    warned.waitFor({ timeout: 60_000 }),
    finished.waitFor({ timeout: 60_000 }),
  ]);
  const result = {
    warned: await warned.isVisible(),
    finishedSilently: await finished.isVisible(),
    downloaded,
    errors,
  };
  await fs.writeFile("tests/export-audio-encoder-results.json", JSON.stringify(result, null, 2));
  console.log(result);
  if (!result.warned || result.finishedSilently || result.downloaded)
    throw new Error("Export without an audio encoder did not stop with a message.");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("PASS: no audio encoder → the export stops and says why, no silent file.");
} finally {
  await browser.close();
}
