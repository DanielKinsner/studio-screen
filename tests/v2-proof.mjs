import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
      viewport: { width: 1480, height: 980 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByText("Saved locally", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Zoom & 3D", exact: true }).click();
  await page.getByRole("button", { name: "Add 3D zoom", exact: true }).click();
  const clip = page.getByRole("button", { name: "3D · 1.35×", exact: true });
  const b = await clip.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 70, b.y + b.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
  expect(
    +(await page.getByLabel("Zoom start", { exact: true }).inputValue()),
  ).toBeGreaterThan(3);
  await page
    .getByRole("button", { name: "Undo (Ctrl+Z)", exact: true })
    .click();
  expect(
    +(await page.getByLabel("Zoom start", { exact: true }).inputValue()),
  ).toBe(2);
  await page.getByRole("button", { name: "Pacing", exact: true }).click();
  await page
    .getByRole("button", { name: "Add speed section", exact: true })
    .click();
  await page.getByLabel("Section speed", { exact: true }).fill("2.5");
  await page.getByText("Saved locally", { exact: true }).waitFor();
  await page.reload();
  await page.getByText("Saved locally", { exact: true }).waitFor();
  await expect(
    page.getByRole("button", { name: "2.5× speed", exact: true }),
  ).toBeVisible();
  const result = await page.evaluate(async () => {
    const { newProject } = await import("/src/types.ts");
    const { renderFrame, releaseCompositor } =
      await import("/src/compositor.ts");
    const { exportProject } = await import("/src/exporter.ts");
    const { loadVideo, seek, releaseVideo } =
      await import("/src/media.ts");
    const { outputDuration } = await import("/src/timeline.ts");
    const { projectFile, readProject } = await import("/src/storage.ts");
    const p = newProject();
    p.trimEnd = 3;
    p.duration = 3;
    p.settings.autoZoom = false;
    p.settings.showCursor = false;
    p.settings.captions = false;
    p.settings.motionBlur = 45;
    p.settings.deviceFrame = "browser";
    p.settings.watermark = "Studio Screen";
    p.captions = [];
    p.zooms = [
      {
        id: "z",
        start: 0,
        end: 3,
        x: 0.5,
        y: 0.5,
        scale: 1.2,
        mode: "3d",
        follow: false,
        tiltX: -15,
        tiltY: 25,
        tiltZ: -4,
      },
    ];
    p.speeds = [{ id: "speed", start: 1, end: 3, rate: 2 }];
    const canvas = document.createElement("canvas");
    canvas.width = 854;
    canvas.height = 480;
    renderFrame(canvas, p, 1.5);
    const expected = canvas.toDataURL();
    const pixels = canvas.getContext("2d").getImageData(0, 0, 854, 480).data;
    const plain = {
      ...p,
      zooms: [],
      settings: { ...p.settings, motionBlur: 0 },
    };
    renderFrame(canvas, plain, 1.5);
    const flat = canvas.getContext("2d").getImageData(0, 0, 854, 480).data;
    let effectDifference = 0;
    for (let i = 0; i < flat.length; i += 4)
      effectDifference += Math.abs(flat[i] - pixels[i]);
    effectDifference /= 854 * 480;
    const restored = await readProject(
      new File([await projectFile(p)], "roundtrip.studio"),
    );
    if (restored.zooms[0].tiltY !== 25 || restored.speeds[0].rate !== 2)
      throw new Error("3D archive roundtrip failed");
    const blob = await exportProject(p, {
      format: "mp4",
      height: 480,
      fps: 30,
      signal: new AbortController().signal,
      progress: () => {},
    });
    const video = await loadVideo(blob);
    await seek(video, 1.25);
    canvas.getContext("2d").drawImage(video, 0, 0);
    const actual = canvas.toDataURL();
    const decoded = canvas.getContext("2d").getImageData(0, 0, 854, 480).data;
    let exportDifference = 0;
    for (let i = 0; i < decoded.length; i += 4)
      exportDifference += Math.abs(decoded[i] - pixels[i]);
    exportDifference /= 854 * 480;
    const duration = video.duration;
    releaseVideo(video);
    releaseCompositor(canvas);
    const data = await new Promise((r) => {
      const f = new FileReader();
      f.onload = () => r(f.result);
      f.readAsDataURL(blob);
    });
    return {
      expected,
      actual,
      data,
      effectDifference,
      exportDifference,
      duration,
      expectedDuration: outputDuration(p),
    };
  });
  await fs.writeFile(
    "tests/3d-expected.png",
    Buffer.from(result.expected.split(",")[1], "base64"),
  );
  await fs.writeFile(
    "tests/3d-export-frame.png",
    Buffer.from(result.actual.split(",")[1], "base64"),
  );
  await fs.writeFile(
    "tests/3d-export.mp4",
    Buffer.from(result.data.split(",")[1], "base64"),
  );
  delete result.expected;
  delete result.actual;
  delete result.data;
  expect(result.effectDifference).toBeGreaterThan(15);
  expect(result.exportDifference).toBeLessThan(10);
  expect(Math.abs(result.duration - result.expectedDuration)).toBeLessThan(0.2);
  expect(errors).toEqual([]);
  await fs.writeFile(
    "tests/v2-results.json",
    JSON.stringify(
      { ...result, errors, dragUndo: true, speedPersistence: true },
      null,
      2,
    ),
  );
  console.log(result);
} finally {
  await browser.close();
}
