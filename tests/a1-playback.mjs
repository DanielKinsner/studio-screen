// Playback hands its position back correctly: pausing keeps the playhead where
// it stopped, stepping and resuming continue from there. Start `npm run dev`.
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1480, height: 980 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByText("Saved locally", { exact: true }).waitFor();
  const playhead = () =>
    page.locator(".playhead").evaluate((el) => parseFloat(el.style.left));
  const shown = () => page.getByLabel("Current time").innerText();
  const play = page.getByRole("button", { name: "Play video", exact: true });
  const pause = page.getByRole("button", {
    name: "Pause playback",
    exact: true,
  });

  const start = await playhead();
  await play.click();
  await page.waitForTimeout(1500);
  const moving = await playhead();
  if (!(moving > start))
    throw new Error("Playhead did not move while playing.");
  await pause.click();
  await page.waitForTimeout(300);
  const paused = await playhead();
  const pausedText = await shown();
  if (paused < moving) throw new Error("Pausing moved the playhead backwards.");
  await page.waitForTimeout(500);
  if ((await playhead()) !== paused || (await shown()) !== pausedText)
    throw new Error("Playhead drifted after pausing.");

  await page.keyboard.press("Shift+ArrowRight");
  const stepped = await playhead();
  if (!(stepped > paused))
    throw new Error(`Stepping jumped from ${paused}% to ${stepped}%.`);

  await play.click();
  await page.waitForTimeout(600);
  const resumed = await playhead();
  await pause.click();
  if (!(resumed > stepped))
    throw new Error("Playback did not resume from the paused position.");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "PASS: pause keeps the playhead, stepping and resuming continue from it.",
  );
} finally {
  await browser.close();
}
