import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import fs from "node:fs/promises";
const { version } = JSON.parse(
  await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const port = await new Promise((resolve) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
const exe = path.resolve(`release/Studio Screen ${version}.exe`);
const processHandle = spawn(exe, [`--remote-debugging-port=${port}`], {
  windowsHide: true,
  stdio: "ignore",
});
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
        timeout: 800,
      });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!browser)
    throw new Error(
      "Portable application did not expose its test debugging port.",
    );
  const page = browser.contexts()[0].pages()[0];
  await page.getByText("Saved locally", { exact: true }).waitFor();
  await expect(page.locator(".app-footer")).toContainText("Desktop studio");
  console.log(
    "Portable bridge diagnostic:",
    await page.evaluate(async () => {
      try {
        return {
          url: location.href,
          count: (await window.studioDesktop.sources()).length,
        };
      } catch (e) {
        return { url: location.href, error: e.message };
      }
    }),
  );
  await page
    .getByRole("button", { name: "New recording", exact: true })
    .click();
  await page.locator(".source-grid button").first().waitFor();
  const source = await page.evaluate(async () =>
    (await window.studioDesktop.sources()).find(
      (s) => s.id.startsWith("window:") && s.name.startsWith("Studio Screen"),
    ),
  );
  if (!source) throw new Error("Cannot find the portable app test window.");
  await page.getByRole("button", { name: source.name, exact: true }).click();
  await page.evaluate(async () => {
    const ctx = new AudioContext();
    await ctx.resume();
    const tone = ctx.createOscillator();
    const gain = ctx.createGain();
    tone.frequency.value = 440;
    gain.gain.value = 0.04;
    tone.connect(gain).connect(ctx.destination);
    tone.start();
    window.portableTestAudio = ctx;
  });
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Finish recording", exact: true })
    .waitFor();
  await new Promise((r) => setTimeout(r, 2200));
  await page
    .getByRole("button", { name: "Finish recording", exact: true })
    .click();
  await page
    .getByText("Recording ready. Make it your own.", { exact: true })
    .waitFor();
  await page.getByText("Saved locally", { exact: true }).waitFor();
  const data = await page.evaluate(async () => {
    await window.portableTestAudio.close();
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("studio-screen", 1);
      r.onsuccess = () => resolve(r.result);
    });
    const projects = await new Promise((resolve) => {
      const r = db.transaction("projects").objectStore("projects").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    const p = projects.sort((a, b) => b.updated - a.updated)[0];
    const encoded = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(p.video);
    });
    return { encoded, duration: p.duration, bytes: p.video.size };
  });
  await fs.writeFile(
    "tests/portable-capture.webm",
    Buffer.from(data.encoded.split(";base64,")[1], "base64"),
  );
  await fs.writeFile(
    "tests/portable-results.json",
    JSON.stringify(
      {
        executable: exe,
        launched: true,
        nativePicker: true,
        captured: true,
        captureDuration: data.duration,
        captureBytes: data.bytes,
        loadedFrom: page.url(),
      },
      null,
      2,
    ),
  );
  await page.evaluate(() => window.close());
  console.log(
    "PASS: final portable EXE launched, selected its own window, recorded with system audio, and saved the recording.",
  );
} finally {
  if (browser) {
    for (const page of browser.contexts().flatMap((c) => c.pages()))
      await page.evaluate(() => window.close()).catch(() => {});
  }
  await browser?.close().catch(() => {});
  if (processHandle.exitCode === null) processHandle.kill();
}
