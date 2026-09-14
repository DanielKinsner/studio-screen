const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  session,
  screen,
  globalShortcut,
  dialog,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
let mainWindow, selectedSource, tracking, pointerTimer;
let barWindow, countdownWindow, recordingDisplay;
const dev = process.argv.includes("--dev");
// Automated tests run against a throwaway profile so they never touch the real
// project library.
if (process.env.STUDIO_USER_DATA)
  app.setPath("userData", path.resolve(process.env.STUDIO_USER_DATA));
// Tests paint the recording bar a unique colour so frames can be scanned for it.
const testMarker = process.env.STUDIO_TEST_MARKER === "1";
const testUnprotected = process.env.STUDIO_TEST_UNPROTECTED === "1";
const entry = pathToFileURL(path.join(__dirname, "../dist/index.html")).href;
const trusted = (url) =>
  dev ? /^http:\/\/127\.0\.0\.1:5173(?:\/|$)/.test(url) : url === entry;
const isMainFrame = (frame) =>
  !!frame &&
  !!mainWindow &&
  frame.processId === mainWindow.webContents.mainFrame.processId &&
  frame.routingId === mainWindow.webContents.mainFrame.routingId;
const assertSender = (event) => {
  if (
    event.sender !== mainWindow?.webContents ||
    !isMainFrame(event.senderFrame)
  )
    throw new Error("Untrusted application request.");
};
const assertBar = (event) => {
  if (!barWindow || event.sender !== barWindow.webContents)
    throw new Error("Untrusted recording bar request.");
};

// Remembered window preferences (currently the interface zoom level).
const statePath = () => path.join(app.getPath("userData"), "window-state.json");
function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return {};
  }
}
function writeState(patch) {
  try {
    fs.writeFileSync(statePath(), JSON.stringify({ ...readState(), ...patch }));
  } catch {}
}

function loadView(win, view) {
  if (dev) return win.loadURL(`http://127.0.0.1:5173/#${view}`);
  return win.loadFile(path.join(__dirname, "../dist/index.html"), {
    hash: view,
  });
}
function lockDown(win) {
  // Keep the window's own title rather than the page's.
  win.on("page-title-updated", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
}
function displayForSource() {
  const byId =
    selectedSource &&
    screen
      .getAllDisplays()
      .find((d) => String(d.id) === selectedSource.display_id);
  return byId || screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}
const overlayOptions = {
  frame: false,
  transparent: true,
  resizable: false,
  movable: false,
  skipTaskbar: true,
  alwaysOnTop: true,
  focusable: false,
  hasShadow: false,
  show: false,
  webPreferences: {
    preload: path.join(__dirname, "preload.cjs"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    backgroundThrottling: false,
  },
};
function protect(win) {
  // Windows display affinity "exclude from capture": visible to Dan, absent
  // from every recording.
  win.setContentProtection(!testUnprotected);
  win.setAlwaysOnTop(true, "screen-saver");
}
function showCountdown(display, seconds) {
  return new Promise((resolve) => {
    const size = 360;
    const area = display.workArea;
    countdownWindow = new BrowserWindow({
      ...overlayOptions,
      title: "Studio Screen Countdown",
      width: size,
      height: size,
      x: Math.round(area.x + (area.width - size) / 2),
      y: Math.round(area.y + (area.height - size) / 2),
    });
    const win = countdownWindow;
    lockDown(win);
    protect(win);
    win.setIgnoreMouseEvents(true);
    win.once("ready-to-show", () => {
      win.showInactive();
      setTimeout(() => {
        if (!win.isDestroyed()) win.close();
        resolve();
      }, seconds * 1000);
    });
    win.on("closed", () => {
      if (countdownWindow === win) countdownWindow = undefined;
      resolve();
    });
    loadView(win, `countdown?${seconds}`);
  });
}
const BAR = { width: 520, height: 76, expanded: 330 };
function barBounds(display, expanded) {
  const area = display.workArea;
  const height = expanded ? BAR.expanded : BAR.height;
  return {
    width: BAR.width,
    height,
    x: Math.round(area.x + (area.width - BAR.width) / 2),
    y: Math.round(area.y + area.height - height - 28),
  };
}
function showBar(display, status) {
  if (barWindow && !barWindow.isDestroyed()) return;
  barWindow = new BrowserWindow({
    ...overlayOptions,
    ...barBounds(display, false),
    title: "Studio Screen Recording",
    movable: true,
  });
  const win = barWindow;
  lockDown(win);
  protect(win);
  win.once("ready-to-show", () => {
    win.showInactive();
    win.webContents.send("studio:status", status);
  });
  win.on("closed", () => {
    if (barWindow !== win) return;
    barWindow = undefined;
    // Closing the bar (for example with Alt+F4) finishes the take.
    mainWindow?.webContents.send("studio:command", "stop");
  });
  loadView(win, testMarker ? "bar?marker" : "bar");
}
function closeRecordingUi() {
  for (const win of [barWindow, countdownWindow]) {
    if (win && !win.isDestroyed()) {
      win.removeAllListeners("closed");
      win.close();
    }
  }
  barWindow = countdownWindow = undefined;
}

function stopTracking() {
  if (tracking) {
    tracking.kill();
    tracking = undefined;
  }
  if (pointerTimer) clearInterval(pointerTimer);
  pointerTimer = undefined;
}
function sendPoint(x, y, click, bounds, shortcut, typing) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const px = (x - bounds.x) / bounds.width,
    py = (y - bounds.y) / bounds.height;
  if (px < 0 || px > 1 || py < 0 || py > 1) return;
  mainWindow.webContents.send("studio:point", {
    x: px,
    y: py,
    click,
    shortcut,
    typing,
  });
}
app.whenReady().then(() => {
  // Electron bounds are device-independent pixels; Windows applies the monitor DPI.
  const { workArea } = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  );
  const width = Math.min(1480, workArea.width),
    height = Math.min(980, workArea.height);
  mainWindow = new BrowserWindow({
    width,
    height,
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    minWidth: Math.min(800, workArea.width),
    minHeight: Math.min(700, workArea.height),
    show: false,
    title: "Studio Screen",
    backgroundColor: "#1d1f21",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  // Zoom is applied only once the window is showing: setting it earlier stops
  // Electron from ever reporting the page as ready to show.
  const applyZoom = () =>
    mainWindow.webContents.setZoomLevel(Number(readState().zoom) || 0);
  mainWindow.once("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.show();
    applyZoom();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!trusted(url)) event.preventDefault();
  });
  // Ctrl + / Ctrl - / Ctrl 0 scale the whole interface and remember it.
  mainWindow.webContents.on("did-finish-load", () => {
    if (mainWindow.isVisible()) applyZoom();
  });
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !input.control || input.alt || input.meta)
      return;
    let zoom = mainWindow.webContents.getZoomLevel();
    if (input.key === "=" || input.key === "+") zoom = Math.min(3, zoom + 0.5);
    else if (input.key === "-" || input.key === "_")
      zoom = Math.max(-2, zoom - 0.5);
    else if (input.key === "0") zoom = 0;
    else return;
    event.preventDefault();
    mainWindow.webContents.setZoomLevel(zoom);
    writeState({ zoom });
  });
  session.defaultSession.setPermissionRequestHandler(
    (contents, permission, callback) =>
      callback(
        contents === mainWindow.webContents &&
          ["media", "display-capture", "fullscreen"].includes(permission),
      ),
  );
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission) =>
      contents === mainWindow.webContents &&
      ["media", "display-capture", "fullscreen"].includes(permission),
  );
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        if (!isMainFrame(request.frame) || !selectedSource) return callback({});
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 0, height: 0 },
        });
        const source = sources.find((s) => s.id === selectedSource.id);
        if (!source) return callback({});
        callback({
          video: source,
          ...(request.audioRequested && process.platform === "win32"
            ? { audio: "loopback" }
            : {}),
        });
      } catch {
        callback({});
      }
    },
  );
  ipcMain.handle("studio:sources", async (event) => {
    assertSender(event);
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 },
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
      displayId: s.display_id,
    }));
  });
  ipcMain.handle("studio:select", async (event, id) => {
    assertSender(event);
    if (typeof id !== "string") throw new Error("Invalid source.");
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 0, height: 0 },
    });
    selectedSource = sources.find((s) => s.id === id);
    if (!selectedSource)
      throw new Error("The selected screen or window is no longer available.");
  });
  // Recording phases driven by the editor: countdown -> recording -> idle.
  ipcMain.handle("studio:recording-ui", async (event, state) => {
    assertSender(event);
    const phase = state?.phase;
    if (phase === "countdown") {
      recordingDisplay = displayForSource();
      mainWindow.hide();
      const seconds = Math.max(
        0,
        Math.min(10, Math.round(+state.seconds || 0)),
      );
      if (seconds) await showCountdown(recordingDisplay, seconds);
    } else if (phase === "recording") {
      showBar(recordingDisplay || displayForSource(), {
        elapsed: 0,
        paused: false,
        notes: String(state.notes || "").slice(0, 20000),
      });
    } else if (phase === "status") {
      barWindow?.webContents.send("studio:status", {
        elapsed: +state.elapsed || 0,
        paused: !!state.paused,
      });
    } else if (phase === "idle") {
      closeRecordingUi();
      recordingDisplay = undefined;
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
  ipcMain.handle("studio:bar-command", (event, name) => {
    assertBar(event);
    if (["pause", "resume", "stop", "discard"].includes(name))
      mainWindow?.webContents.send("studio:command", name);
  });
  ipcMain.handle("studio:bar-expand", (event, expanded) => {
    assertBar(event);
    const display = screen.getDisplayMatching(barWindow.getBounds());
    barWindow.setBounds(barBounds(display, !!expanded));
  });
  ipcMain.handle("studio:track", async (event, enabled) => {
    assertSender(event);
    stopTracking();
    if (enabled !== true || !selectedSource) return;
    const handle = /^window:(\d+):/.exec(selectedSource.id)?.[1];
    if (handle && process.platform !== "win32") return;
    const display = screen
      .getAllDisplays()
      .find((d) => String(d.id) === selectedSource.display_id);
    if (!display && !handle) return;
    const bounds = display?.bounds;
    if (process.platform === "win32") {
      const trackerPath = app.isPackaged
        ? path.join(
            process.resourcesPath,
            "app.asar.unpacked",
            "electron",
            "pointer.ps1",
          )
        : path.join(__dirname, "pointer.ps1");
      tracking = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          trackerPath,
          "-WindowHandle",
          handle || "0",
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
      );
      let buffer = "";
      tracking.stdout.on("data", (data) => {
        buffer += data.toString();
        let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          try {
            const [x, y, click, shortcut, typing, left, top, width, height] =
              JSON.parse(line);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            if (handle) {
              if (width > 0 && height > 0)
                sendPoint(
                  x,
                  y,
                  !!click,
                  { x: left, y: top, width, height },
                  shortcut,
                  typing,
                );
            } else {
              const dip = screen.screenToDipPoint({ x, y });
              sendPoint(dip.x, dip.y, !!click, bounds, shortcut, typing);
            }
          } catch {}
        }
      });
      tracking.on("error", () => {
        tracking = undefined;
      });
    } else
      pointerTimer = setInterval(() => {
        const pt = screen.getCursorScreenPoint();
        sendPoint(pt.x, pt.y, false, bounds);
      }, 33);
  });
  globalShortcut.register("CommandOrControl+Shift+R", () => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send("studio:stop");
  });
  mainWindow.on("closed", () => {
    stopTracking();
    closeRecordingUi();
    mainWindow = undefined;
  });
  if (dev) mainWindow.loadURL("http://127.0.0.1:5173");
  else mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
});
app.on("will-quit", () => {
  stopTracking();
  globalShortcut.unregisterAll();
});
app.on("window-all-closed", () => app.quit());
