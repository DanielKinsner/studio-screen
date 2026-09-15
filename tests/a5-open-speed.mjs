// A5: a 5-minute recording opens in the editor, already auto-edited, within
// 3 s of pressing Finish. A scripted stand-in helper (tests/fake-helper.cjs)
// delivers a prepared 5-minute take, so the screen is never recorded; the app
// path after Finish (event log read, auto-edit, project open, video load,
// first preview frame) is the real one. Start `npm run dev` first. The app
// window hides and reappears briefly, so it waits for 30 s of idle.
import { _electron as electron, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);
const root = process.cwd();
const ffmpeg =
  process.env.FFMPEG_PATH ||
  "C:/Program Files (x86)/Common Files/AutoPod/ffmpeg/bin/ffmpeg.exe";
const take = path.join(root, "tests/.fake-take");
const seconds = 300;

if (!process.argv.includes("--force")) {
  const { stdout } = await run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "tests/idle.ps1",
  ]);
  if (+stdout.trim() < 30) {
    console.log(
      `SKIPPED: the PC was used ${(+stdout.trim()).toFixed(0)} s ago. Run when idle, or pass --force.`,
    );
    process.exit(3);
  }
}

await fs.mkdir(take, { recursive: true });
if (!existsSync(path.join(take, "recording.mp4"))) {
  console.log("Building a 5-minute fragmented MP4 take…");
  await run(
    ffmpeg,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=1920x1080:rate=60:duration=${seconds}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=330:sample_rate=48000:duration=${seconds}`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "35",
      "-g",
      "120",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "frag_keyframe+empty_moov+default_base_moof",
      path.join(take, "recording.mp4"),
    ],
    { maxBuffer: 1 << 26 },
  );
}
{
  // Five minutes of input: 240 Hz pointer, clicks every 7 s, typing bursts,
  // screen activity with a few idle stretches, cursor-shape changes.
  const lines = [];
  for (let i = 0; i < seconds * 240; i++) {
    const t = i / 240;
    const idle = t % 60 > 40 && t % 60 < 50;
    if (!idle || i % 240 === 0)
      lines.push({
        t: +t.toFixed(4),
        k: "m",
        x: +(0.5 + 0.3 * Math.sin(t / 4)).toFixed(4),
        y: +(0.5 + 0.2 * Math.cos(t / 5)).toFixed(4),
      });
    if (i % (240 * 7) === 120)
      lines.push({ t: +t.toFixed(4), k: "d", b: "left", x: 0.5, y: 0.5 });
    if (i % (240 * 30) < 240 * 2 && i % 40 === 0)
      lines.push({ t: +t.toFixed(4), k: "y" });
    if (!idle && i % 12 === 0)
      lines.push({ t: +t.toFixed(4), k: "f", a: 0.01 });
    if (i % (240 * 20) === 0)
      lines.push({ t: +t.toFixed(4), k: "c", c: i % 480 ? "text" : "arrow" });
  }
  await fs.writeFile(
    path.join(take, "events.jsonl"),
    lines.map((l) => JSON.stringify(l)).join("\n"),
  );
}

const projects = path.join(root, "tests/.projects-a5");
await fs.rm(projects, { recursive: true, force: true });
const app = await electron.launch({
  args: [".", "--dev"],
  cwd: root,
  env: {
    ...process.env,
    STUDIO_USER_DATA: path.join(root, "tests/.profile-a5"),
    STUDIO_PROJECTS_DIR: projects,
    STUDIO_FAKE_HELPER: path.join(root, "tests/fake-helper.cjs"),
    STUDIO_FAKE_TAKE: take,
    STUDIO_FAKE_SECONDS: String(seconds),
  },
});
const results = {};
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByText("Saved locally", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "New recording", exact: true })
    .click();
  await page.locator(".source-grid button").first().click();
  const toggle = page.getByRole("switch", {
    name: "3-second countdown",
    exact: true,
  });
  if ((await toggle.getAttribute("aria-checked")) === "true")
    await toggle.click();
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await expect
    .poll(() => app.windows().some((p) => p.url().includes("#bar")), {
      timeout: 20000,
    })
    .toBe(true);
  const bar = app.windows().find((p) => p.url().includes("#bar"));
  await page.waitForTimeout(1000);
  const finished = Date.now();
  await bar.getByRole("button", { name: "Finish" }).click();
  await page.getByText(/Auto-edit:/).waitFor({ timeout: 30000 });
  const edited = Date.now() - finished;
  const toast = await page.locator(".toast").innerText();
  // First preview frame: the test pattern's saturated colours on the canvas.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const canvas = document.querySelector(
            '[aria-label="Composited video preview"]',
          );
          const probe = document.createElement("canvas");
          probe.width = 160;
          probe.height = 90;
          const ctx = probe.getContext("2d");
          ctx.drawImage(canvas, 0, 0, 160, 90);
          const d = ctx.getImageData(0, 0, 160, 90).data;
          let colourful = 0;
          for (let i = 0; i < d.length; i += 4)
            if (
              Math.max(d[i], d[i + 1], d[i + 2]) -
                Math.min(d[i], d[i + 1], d[i + 2]) >
              150
            )
              colourful++;
          return colourful;
        }),
      { timeout: 30000, intervals: [100] },
    )
    .toBeGreaterThan(300);
  const framed = Date.now() - finished;
  // The preview can open before the 700 ms autosave debounce. Reading IndexedDB
  // immediately returned the previous 24-second sample instead of this take.
  // Keep that persistence wait outside the preview/open timing measurement.
  await page.getByText("Saved locally", { exact: true }).waitFor();
  const saved = Date.now() - finished;
  const project = await page.evaluate(async () => {
    const { listProjects } = await import("/src/storage.ts");
    const p = (await listProjects()).sort((a, b) => b.updated - a.updated)[0];
    return {
      duration: p.duration,
      trimStart: p.trimStart,
      trimEnd: p.trimEnd,
      points: p.points.length,
      speeds: p.speeds.length,
      auto: !!p.autoEdit,
    };
  });
  results.open = {
    editedMs: edited,
    firstFrameMs: framed,
    savedMs: saved,
    toast,
    project,
    errors,
  };
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close().catch(() => {});
}
await fs.rm(projects, { recursive: true, force: true });
await fs.writeFile(
  path.join(root, "tests/a5-results.json"),
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
expect(results.open.errors).toEqual([]);
expect(results.open.project.auto).toBe(true);
expect(results.open.project.duration).toBeCloseTo(seconds, 0);
expect(results.open.editedMs).toBeLessThan(3000);
expect(results.open.firstFrameMs).toBeLessThan(3000);
console.log(
  "PASS: a 5-minute take opens auto-edited, with its first frame, within 3 s of Finish.",
);
