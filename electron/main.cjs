const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  session,
  screen,
  globalShortcut,
  dialog,
  shell,
  protocol,
} = require("electron");
const { Readable } = require("node:stream");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
let mainWindow, selectedSource, pointerTimer, helper;
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

// Finished videos stream straight to disk here (tests point it elsewhere).
const exportsDir = () =>
  process.env.STUDIO_EXPORT_DIR
    ? path.resolve(process.env.STUDIO_EXPORT_DIR)
    : path.join(app.getPath("videos"), "Studio Screen", "Exports");
const openExports = new Map();
async function uniquePath(dir, name, extension) {
  const base = (
    name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim() || "Studio Screen"
  ).slice(0, 80);
  for (let i = 0; ; i++) {
    const file = path.join(
      dir,
      `${base}${i ? ` (${i + 1})` : ""}.${extension}`,
    );
    try {
      await fs.promises.access(file);
    } catch {
      return file;
    }
  }
}

// Recordings live in one folder each; tests point this somewhere disposable.
const projectsDir = () =>
  process.env.STUDIO_PROJECTS_DIR
    ? path.resolve(process.env.STUDIO_PROJECTS_DIR)
    : path.join(app.getPath("videos"), "Studio Screen");
const inside = (file, dir) => {
  const relative = path.relative(dir, path.resolve(file));
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
};
function helperPath() {
  const file = app.isPackaged
    ? path.join(process.resourcesPath, "studio-capture.exe")
    : path.join(
        __dirname,
        "../native/studio-capture/target/release/studio-capture.exe",
      );
  if (process.env.STUDIO_FAKE_HELPER) return process.env.STUDIO_FAKE_HELPER;
  return process.platform === "win32" && fs.existsSync(file) ? file : null;
}
const stamp = (date) => {
  const two = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}.${two(date.getMinutes())}.${two(date.getSeconds())}`;
};
async function writeMeta(folder, patch) {
  const file = path.join(folder, "meta.json");
  let meta = {};
  try {
    meta = JSON.parse(await fs.promises.readFile(file, "utf8"));
  } catch {}
  await fs.promises.writeFile(
    file,
    JSON.stringify({ ...meta, ...patch }, null, 2),
  );
}
// Serves recordings to the editor with byte ranges, so partly written or
// crash-cut fragmented MP4s still report their duration and seek.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "studio-media",
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
async function serveMedia(request) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Range",
    "Access-Control-Expose-Headers":
      "Content-Range, Content-Length, Accept-Ranges",
  };
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  const file = path.resolve(
    decodeURIComponent(new URL(request.url).pathname.slice(1)),
  );
  if (!inside(file, projectsDir()))
    return new Response("Forbidden", { status: 403, headers: cors });
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat?.isFile())
    return new Response("Not found", { status: 404, headers: cors });
  const type = file.endsWith(".mp4")
    ? "video/mp4"
    : file.endsWith(".json") || file.endsWith(".jsonl")
      ? "application/json"
      : "application/octet-stream";
  const headers = { ...cors, "Content-Type": type, "Accept-Ranges": "bytes" };
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get("range") || "");
  if (range && stat.size > 0) {
    let start = range[1]
      ? Number(range[1])
      : Math.max(0, stat.size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    end = Math.min(end, stat.size - 1);
    if (start > end)
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${stat.size}` },
      });
    return new Response(
      Readable.toWeb(fs.createReadStream(file, { start, end })),
      {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Content-Length": String(end - start + 1),
        },
      },
    );
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), {
    status: 200,
    headers: { ...headers, "Content-Length": String(stat.size) },
  });
}
const mediaUrl = (file) => `studio-media://media/${encodeURIComponent(file)}`;

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
  protocol.handle("studio-media", serveMedia);
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
  ipcMain.handle("studio:export-open", async (event, name, extension) => {
    assertSender(event);
    if (!["mp4", "webm", "gif"].includes(extension))
      throw new Error("Unsupported export format.");
    const dir = exportsDir();
    await fs.promises.mkdir(dir, { recursive: true });
    const file = await uniquePath(dir, String(name || ""), extension);
    const handle = await fs.promises.open(file, "w");
    const id = randomUUID();
    openExports.set(id, { handle, file });
    return { id, path: file };
  });
  ipcMain.handle("studio:export-write", async (event, id, position, data) => {
    assertSender(event);
    const entry = openExports.get(id);
    if (!entry || !(data instanceof Uint8Array) || !(position >= 0))
      throw new Error("Invalid export write.");
    await entry.handle.write(data, 0, data.length, position);
  });
  ipcMain.handle("studio:export-close", async (event, id, keep) => {
    assertSender(event);
    const entry = openExports.get(id);
    if (!entry) return;
    openExports.delete(id);
    await entry.handle.close();
    // A cancelled or failed export never leaves a half-written file behind.
    if (!keep) await fs.promises.rm(entry.file, { force: true });
  });
  ipcMain.handle("studio:reveal", (event, file) => {
    assertSender(event);
    const resolved = path.resolve(String(file));
    if (!resolved.startsWith(exportsDir() + path.sep))
      throw new Error("Can only show exported files.");
    shell.showItemInFolder(resolved);
  });
  ipcMain.handle("studio:bar-command", (event, name) => {
    assertBar(event);
    if (!["pause", "resume", "stop", "discard"].includes(name)) return;
    // Where the bar sat on the recorded display, so the auto-edit can drop the
    // reach for it. Window recordings don't need it: the bar is outside them.
    let bar;
    if (
      name === "stop" &&
      barWindow &&
      recordingDisplay &&
      selectedSource?.id.startsWith("screen:")
    ) {
      const b = barWindow.getBounds(),
        d = recordingDisplay.bounds;
      bar = {
        x: (b.x - d.x) / d.width,
        y: (b.y - d.y) / d.height,
        width: b.width / d.width,
        height: b.height / d.height,
      };
    }
    mainWindow?.webContents.send("studio:command", name, bar);
  });
  ipcMain.handle("studio:bar-expand", (event, expanded) => {
    assertBar(event);
    const display = screen.getDisplayMatching(barWindow.getBounds());
    barWindow.setBounds(barBounds(display, !!expanded));
  });
  // Browser-capture fallback only: pointer position polling (no clicks or
  // keys). Native recordings get full input events from the capture helper.
  ipcMain.handle("studio:track", async (event, enabled) => {
    assertSender(event);
    stopTracking();
    if (enabled !== true || !selectedSource) return;
    const display = screen
      .getAllDisplays()
      .find((d) => String(d.id) === selectedSource.display_id);
    if (!display) return;
    pointerTimer = setInterval(() => {
      const pt = screen.getCursorScreenPoint();
      sendPoint(pt.x, pt.y, false, display.bounds);
    }, 16);
  });

  ipcMain.handle("studio:native-available", (event) => {
    assertSender(event);
    return !!helperPath() && process.env.STUDIO_DISABLE_NATIVE !== "1";
  });
  ipcMain.handle("studio:native-start", async (event, options) => {
    assertSender(event);
    const exe = helperPath();
    if (!exe) throw new Error("The capture helper is not installed.");
    if (helper) throw new Error("A recording is already running.");
    if (!selectedSource) throw new Error("Choose a screen or window first.");
    const folder = path.join(projectsDir(), stamp(new Date()));
    await fs.promises.mkdir(folder, { recursive: true });
    const video = path.join(folder, "recording.mp4");
    const events = path.join(folder, "events.jsonl");
    const config = {
      output: video,
      events,
      fps: Math.max(10, Math.min(60, Math.round(+options?.fps || 60))),
      audio: options?.audio !== false,
      armed: true,
      parent: process.pid,
      cursor: process.env.STUDIO_TEST_CAPTURE_CURSOR === "1",
    };
    const region = options?.region;
    if (
      region &&
      [region.x, region.y, region.width, region.height].every(Number.isFinite)
    )
      config.region = {
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
      };
    const hwnd = /^window:(\d+):/.exec(selectedSource.id)?.[1];
    if (hwnd) config.window = Number(hwnd);
    else {
      const display = displayForSource();
      const centre = screen.dipToScreenPoint({
        x: display.bounds.x + display.bounds.width / 2,
        y: display.bounds.y + display.bounds.height / 2,
      });
      config.monitor = { x: Math.round(centre.x), y: Math.round(centre.y) };
    }
    await writeMeta(folder, {
      version: 1,
      status: "recording",
      created: new Date().toISOString(),
      source: selectedSource.name,
      fps: config.fps,
      video: "recording.mp4",
      events: "events.jsonl",
    });
    // Tests can stand in a scripted helper that replays a prepared take.
    const fake = process.env.STUDIO_FAKE_HELPER;
    const child = fake
      ? spawn(process.execPath, [fake, "record", JSON.stringify(config)], {
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        })
      : spawn(exe, ["record", JSON.stringify(config)], {
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
    const current = (helper = { child, folder, stopped: false });
    const send = (message) => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send("studio:native-event", message);
    };
    return await new Promise((resolve, reject) => {
      let ready = false,
        buffer = "",
        errorText = "";
      child.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (message.event === "ready" && !ready) {
            ready = true;
            resolve({
              folder,
              videoUrl: mediaUrl(video),
              width: message.width,
              height: message.height,
            });
          } else if (message.event === "error") {
            errorText = message.message;
            if (!ready) reject(new Error(message.message));
          } else if (message.event === "started") {
            void writeMeta(folder, {
              width: message.width,
              height: message.height,
              audio: message.audio,
            });
          } else if (message.event === "stopped") {
            current.stopped = true;
            void writeMeta(folder, {
              status: "done",
              duration: message.seconds,
              reason: message.reason,
            });
          }
          send(message);
        }
      });
      child.stderr.on("data", (chunk) => (errorText += chunk.toString()));
      child.on("error", (e) => {
        if (!ready) reject(e);
      });
      child.on("exit", (code) => {
        if (helper === current) helper = undefined;
        if (!ready)
          reject(
            new Error(
              errorText.trim() || `The capture helper stopped (code ${code}).`,
            ),
          );
        else if (!current.stopped) {
          void writeMeta(folder, { status: "interrupted" });
          send({ event: "exit", code, message: errorText.trim() });
        }
      });
    });
  });
  ipcMain.handle("studio:native-command", (event, command) => {
    assertSender(event);
    if (helper && ["begin", "pause", "resume", "stop"].includes(command))
      helper.child.stdin.write(command + "\n");
  });
  ipcMain.handle("studio:native-events", async (event, folder) => {
    assertSender(event);
    const file = path.join(String(folder), "events.jsonl");
    if (!inside(file, projectsDir()))
      throw new Error("Invalid recording folder.");
    return fs.promises.readFile(file, "utf8").catch(() => "");
  });
  // Recordings the app never got to open: it closed or crashed mid-take.
  ipcMain.handle("studio:recoveries", async (event) => {
    assertSender(event);
    const dir = projectsDir();
    const entries = await fs.promises
      .readdir(dir, { withFileTypes: true })
      .catch(() => []);
    const found = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folder = path.join(dir, entry.name);
      if (helper?.folder === folder) continue;
      try {
        const meta = JSON.parse(
          await fs.promises.readFile(path.join(folder, "meta.json"), "utf8"),
        );
        if (!["recording", "interrupted"].includes(meta.status)) continue;
        const stat = await fs.promises.stat(path.join(folder, "recording.mp4"));
        if (stat.size > 0)
          found.push({
            folder,
            name: entry.name,
            videoUrl: mediaUrl(path.join(folder, "recording.mp4")),
            created: meta.created,
          });
      } catch {}
    }
    return found;
  });
  ipcMain.handle("studio:recovery-done", async (event, folder) => {
    assertSender(event);
    if (!inside(path.join(String(folder), "meta.json"), projectsDir())) return;
    await writeMeta(String(folder), { status: "recovered" });
  });
  ipcMain.handle("studio:project-save", async (event, folder, json) => {
    assertSender(event);
    const file = path.join(String(folder), "project.json");
    if (!inside(file, projectsDir()) || typeof json !== "string") return;
    await fs.promises.writeFile(file, json).catch(() => {});
  });
  globalShortcut.register("CommandOrControl+Shift+R", () => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send("studio:stop");
  });
  mainWindow.on("closed", () => {
    stopTracking();
    // Finish any take in progress cleanly before the app goes away.
    helper?.child.stdin.write("stop\n");
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
