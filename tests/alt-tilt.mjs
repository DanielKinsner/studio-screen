// Alt in the desktop app (Electron Playwright; synthetic input, safe while the
// PC is in use). Start `npm run dev` first.
// Input is sent with webContents.sendInputEvent, which (unlike Playwright's
// keyboard) goes through the window's own Alt handling: before the fix, an
// Alt press here revealed the menu bar and moved the page down.
//  1. Alt press and release never show the menu bar or move the content.
//  2. Alt+drag on the preview tilts the selected 3D zoom.
//  3. Ctrl+V still pastes into a text field; Ctrl+Shift+I still opens DevTools.
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const profile = path.join(root, "tests/.profile-alt");
await fs.rm(profile, { recursive: true, force: true });
// Recoveries on launch scan the recordings folder: keep it throwaway too.
const env = {
  ...process.env,
  STUDIO_USER_DATA: profile,
  STUDIO_PROJECTS_DIR: path.join(profile, "recordings"),
};
delete env.STUDIO_EXPORT_DIR;
const results = {};
const app = await electron.launch({ args: [".", "--dev"], cwd: root, env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByText("Saved locally", { exact: true }).waitFor();
  const send = (events) =>
    app.evaluate(({ BrowserWindow }, list) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      for (const event of list) contents.sendInputEvent(event);
    }, events);
  const windowState = () =>
    app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return {
        menuVisible: w.isMenuBarVisible(),
        autoHide: w.isMenuBarAutoHide(),
        content: w.getContentBounds(),
      };
    });

  // 1. Alt alone.
  const before = await windowState();
  await send([
    { type: "keyDown", keyCode: "Alt" },
    { type: "keyUp", keyCode: "Alt" },
  ]);
  await page.waitForTimeout(400);
  results.altPress = { before, after: await windowState() };
  expect(results.altPress.after).toEqual({ ...before, menuVisible: false });

  // 2. Alt+drag tilts a 3D zoom.
  await page.getByRole("button", { name: "Focus & 3D", exact: true }).click();
  await page.getByRole("button", { name: "Add 3D zoom", exact: true }).click();
  const tiltY = page.getByLabel("Tilt left / right", { exact: true });
  await expect(tiltY).toHaveValue("18");
  const box = await page.getByLabel("Composited video preview").boundingBox();
  const x = Math.round(box.x + box.width * 0.8),
    y = Math.round(box.y + box.height * 0.75);
  const alt = ["alt"];
  await send([
    { type: "keyDown", keyCode: "Alt" },
    { type: "mouseMove", x, y, modifiers: alt },
    { type: "mouseDown", x, y, button: "left", clickCount: 1, modifiers: alt },
    ...Array.from({ length: 8 }, (_, i) => ({
      type: "mouseMove",
      x: x + (i + 1) * 10,
      y,
      button: "left",
      modifiers: [...alt, "leftButtonDown"],
    })),
    {
      type: "mouseUp",
      x: x + 80,
      y,
      button: "left",
      clickCount: 1,
      modifiers: alt,
    },
    { type: "keyUp", keyCode: "Alt" },
  ]);
  await page.waitForTimeout(400);
  results.altDrag = {
    tiltY: +(await tiltY.inputValue()),
    window: await windowState(),
  };
  expect(results.altDrag.tiltY).toBe(38);
  expect(results.altDrag.window).toEqual({ ...before, menuVisible: false });

  // 3. The hidden menu's shortcuts still work.
  await app.evaluate(({ clipboard }) => clipboard.writeText("Pasted by test"));
  const name = page.getByLabel("Project name", { exact: true });
  await name.click();
  await send([
    { type: "keyDown", keyCode: "A", modifiers: ["control"] },
    { type: "keyUp", keyCode: "A", modifiers: ["control"] },
    { type: "keyDown", keyCode: "V", modifiers: ["control"] },
    { type: "keyUp", keyCode: "V", modifiers: ["control"] },
  ]);
  await expect(name).toHaveValue("Pasted by test");
  await send([
    { type: "keyDown", keyCode: "I", modifiers: ["control", "shift"] },
    { type: "keyUp", keyCode: "I", modifiers: ["control", "shift"] },
  ]);
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.isDevToolsOpened(),
      ),
    )
    .toBe(true);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.closeDevTools(),
  );
  results.shortcuts = { paste: true, devTools: true };
  results.errors = errors;
  expect(errors).toEqual([]);
} finally {
  await fs.writeFile(
    path.join(root, "tests/alt-tilt-results.json"),
    JSON.stringify(results, null, 2),
  );
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close().catch(() => {});
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
}
console.log(JSON.stringify(results));
console.log(
  "PASS: Alt never shows the menu bar or moves the page, Alt+drag tilts the 3D zoom, paste and DevTools shortcuts still work.",
);
