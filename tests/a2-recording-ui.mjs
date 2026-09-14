// A2: recording gets out of the way. Start `npm run dev` first; run while the
// desktop is idle (it records the display the editor is on for a few seconds).
//
// Run 1: countdown on. The editor hides, a countdown appears, then the floating
// bar. The bar is painted magenta (test marker) and must be absent from every
// recorded frame, and must not leave a black box either. Finish brings the
// editor back to the front.
// Run 2 (control): same, with capture exclusion switched off. The magenta bar
// must be found, proving the frame scan can see it.
import { _electron as electron, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const ffmpeg =
  process.env.FFMPEG_PATH ||
  "C:/Program Files (x86)/Common Files/AutoPod/ffmpeg/bin/ffmpeg.exe";

async function record({ unprotected }) {
  const app = await electron.launch({
    args: [".", "--dev"],
    cwd: root,
    env: {
      ...process.env,
      STUDIO_TEST_MARKER: "1",
      STUDIO_USER_DATA: path.join(root, "tests/.profile"),
      STUDIO_PROJECTS_DIR: path.join(root, "tests/.projects"),
      ...(unprotected ? { STUDIO_TEST_UNPROTECTED: "1" } : {}),
    },
  });
  const windows = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => ({
        // The editor is always the first window; its title comes from the page.
        title: w.id === 1 ? "Studio Screen" : w.getTitle(),
        visible: w.isVisible(),
        focused: w.isFocused(),
        bounds: w.getBounds(),
      })),
    );
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByText("Saved locally", { exact: true }).waitFor();
    // Regression: applying the saved zoom too early once kept the editor
    // window from ever appearing.
    await expect
      .poll(async () => (await windows())[0].visible, { timeout: 10000 })
      .toBe(true);
    await page
      .getByRole("button", { name: "New recording", exact: true })
      .click();
    // Record the display the editor is on.
    const displayId = await app.evaluate(({ BrowserWindow, screen }) => {
      const main = BrowserWindow.getAllWindows()[0];
      return String(screen.getDisplayMatching(main.getBounds()).id);
    });
    const sources = await page.evaluate(() => window.studioDesktop.sources());
    const index = sources.findIndex(
      (s) => s.id.startsWith("screen:") && s.displayId === displayId,
    );
    if (index < 0) throw new Error("Could not find the editor's display.");
    await page.locator(".source-grid button").nth(index).click();
    const countdown = page.getByRole("switch", {
      name: "3-second countdown",
      exact: true,
    });
    await expect(countdown).toHaveAttribute("aria-checked", "true");
    await page
      .getByRole("button", { name: "Start recording", exact: true })
      .click();
    console.log(unprotected ? "control:" : "protected:", "recording started");

    const sawCountdown = await expect
      .poll(async () =>
        (await windows()).some(
          (w) => w.title === "Studio Screen Countdown" && w.visible,
        ),
      )
      .toBe(true)
      .then(() => true);
    const hiddenDuringCountdown = !(await windows()).find(
      (w) => w.title === "Studio Screen",
    ).visible;
    await expect
      .poll(
        async () =>
          (await windows()).some(
            (w) => w.title === "Studio Screen Recording" && w.visible,
          ),
        { timeout: 15000 },
      )
      .toBe(true);
    const during = await windows();
    const bar = during.find((w) => w.title === "Studio Screen Recording");
    const display = await app.evaluate(({ screen }, id) => {
      const d = screen.getAllDisplays().find((d) => String(d.id) === id);
      return d.bounds;
    }, displayId);
    await new Promise((r) => setTimeout(r, 2500));
    console.log("bar visible; finishing");
    const barPage = app.windows().find((p) => p.url().includes("#bar"));
    await barPage.getByRole("button", { name: "Finish" }).click();
    await page.getByText(/Recording ready/).waitFor({ timeout: 20000 });
    await page.getByText("Saved locally", { exact: true }).waitFor();
    const after = await windows();
    const main = after.find((w) => w.title === "Studio Screen");
    const leftovers = after.filter((w) => w.title !== "Studio Screen");

    const data = await page.evaluate(async () => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open("studio-screen", 1);
        r.onsuccess = () => res(r.result);
        r.onerror = rej;
      });
      const projects = await new Promise((res, rej) => {
        const r = db.transaction("projects").objectStore("projects").getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = rej;
      });
      const p = projects.sort((a, b) => b.updated - a.updated)[0];
      // Native recordings stay on disk; browser-capture ones live in the database.
      if (p.folder) return { folder: p.folder };
      return await new Promise((res) => {
        const reader = new FileReader();
        reader.onload = () => res({ data: reader.result });
        reader.readAsDataURL(p.video);
      });
    });
    const file = data.folder
      ? path.join(data.folder, "recording.mp4")
      : path.join(root, `tests/a2-${unprotected ? "control" : "protected"}.webm`);
    if (!data.folder)
      await fs.writeFile(file, Buffer.from(data.data.split(";base64,")[1], "base64"));
    return {
      file,
      errors,
      sawCountdown,
      hiddenDuringCountdown,
      barVisible: !!bar,
      mainVisibleAfter: main.visible,
      mainFocusedAfter: main.focused,
      leftoverWindows: leftovers.map((w) => w.title),
      // Bar rectangle as a fraction of the recorded display.
      barRect: {
        x: (bar.bounds.x - display.x) / display.width,
        y: (bar.bounds.y - display.y) / display.height,
        width: bar.bounds.width / display.width,
        height: bar.bounds.height / display.height,
      },
    };
  } finally {
    // Exit directly: a pending autosave would otherwise raise a leave-page prompt.
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  }
}

/** Decode frames at 640 px wide and count marker and pure-black pixels in the bar area. */
function scan(file, rect) {
  return new Promise((resolve, reject) => {
    const width = 640;
    const probe = spawn(ffmpeg, [
      "-v",
      "error",
      "-i",
      file,
      "-vf",
      `fps=4,scale=${width}:-2`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ]);
    const chunks = [];
    probe.stdout.on("data", (c) => chunks.push(c));
    probe.on("error", reject);
    probe.on("close", async () => {
      const raw = Buffer.concat(chunks);
      // Height comes from the first frame's aspect: read it with a second pass.
      const info = spawn(ffmpeg, ["-i", file]);
      let text = "";
      info.stderr.on("data", (d) => (text += d));
      info.on("close", () => {
        const m = /, (\d{2,5})x(\d{2,5})/.exec(text);
        const height = Math.round((width * +m[2]) / +m[1] / 2) * 2;
        const size = width * height * 3;
        const frames = Math.floor(raw.length / size);
        const x0 = Math.floor(rect.x * width),
          y0 = Math.floor(rect.y * height),
          x1 = Math.ceil((rect.x + rect.width) * width),
          y1 = Math.ceil((rect.y + rect.height) * height);
        const result = [];
        for (let f = 0; f < frames; f++) {
          let magenta = 0,
            black = 0,
            area = 0;
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
              const i = f * size + (y * width + x) * 3;
              const r = raw[i],
                g = raw[i + 1],
                b = raw[i + 2];
              if (r > 200 && g < 70 && b > 200) magenta++;
              if (x >= x0 && x < x1 && y >= y0 && y < y1) {
                area++;
                if (r <= 3 && g <= 3 && b <= 3) black++;
              }
            }
          result.push({ magenta, blackShare: area ? black / area : 0 });
        }
        resolve(result);
      });
    });
  });
}

const protectedRun = await record({ unprotected: false });
const protectedFrames = await scan(protectedRun.file, protectedRun.barRect);
const controlRun = await record({ unprotected: true });
const controlFrames = await scan(controlRun.file, controlRun.barRect);
const results = {
  protectedRun: {
    ...protectedRun,
    frames: protectedFrames.length,
    maxMagenta: Math.max(...protectedFrames.map((f) => f.magenta)),
    maxBlackShare: Math.max(...protectedFrames.map((f) => f.blackShare)),
  },
  controlRun: {
    ...controlRun,
    frames: controlFrames.length,
    maxMagenta: Math.max(...controlFrames.map((f) => f.magenta)),
  },
};
// The recordings contain whatever was on screen; keep only the measurements.
await fs.rm(protectedRun.file, { force: true });
await fs.rm(controlRun.file, { force: true });
await fs.writeFile(
  path.join(root, "tests/a2-results.json"),
  JSON.stringify(results, null, 2),
);
console.log(results);
const p = results.protectedRun,
  c = results.controlRun;
expect(p.errors).toEqual([]);
expect(p.sawCountdown).toBe(true);
expect(p.hiddenDuringCountdown).toBe(true);
expect(p.barVisible).toBe(true);
expect(p.mainVisibleAfter).toBe(true);
expect(p.mainFocusedAfter).toBe(true);
expect(p.leftoverWindows).toEqual([]);
expect(p.frames).toBeGreaterThan(4);
expect(p.maxMagenta).toBeLessThan(50);
expect(p.maxBlackShare).toBeLessThan(0.5);
expect(c.maxMagenta).toBeGreaterThan(500);
console.log(
  "PASS: countdown, editor hides, bar absent from footage (control run sees it), editor returns focused.",
);
