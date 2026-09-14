const { app, BrowserWindow, desktopCapturer, ipcMain, session, screen, globalShortcut, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
let mainWindow, selectedSource, tracking, pointerTimer;
const dev = process.argv.includes('--dev');
const entry = pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
const trusted = url => dev ? /^http:\/\/127\.0\.0\.1:5173(?:\/|$)/.test(url) : url === entry;
const isMainFrame = frame => !!frame && !!mainWindow && frame.processId === mainWindow.webContents.mainFrame.processId && frame.routingId === mainWindow.webContents.mainFrame.routingId;
const assertSender = event => { if (event.sender !== mainWindow?.webContents || !isMainFrame(event.senderFrame)) throw new Error('Untrusted application request.'); };
function stopTracking() { if (tracking) { tracking.kill(); tracking = undefined; } if (pointerTimer) clearInterval(pointerTimer); pointerTimer = undefined; }
function sendPoint(x, y, click, bounds) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const px = (x - bounds.x) / bounds.width, py = (y - bounds.y) / bounds.height;
  if (px < 0 || px > 1 || py < 0 || py > 1) return;
  mainWindow.webContents.send('studio:point', { x: px, y: py, click });
}
app.whenReady().then(() => {
  mainWindow = new BrowserWindow({ width: 1480, height: 980, minWidth: 800, minHeight: 700, title: 'Studio Screen', backgroundColor: '#1d1f21', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!trusted(url)) event.preventDefault(); });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(contents === mainWindow.webContents && ['media', 'display-capture', 'fullscreen'].includes(permission)));
  session.defaultSession.setPermissionCheckHandler((contents, permission) => contents === mainWindow.webContents && ['media', 'display-capture', 'fullscreen'].includes(permission));
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (!isMainFrame(request.frame) || !selectedSource) return callback({});
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
      const source = sources.find(s => s.id === selectedSource.id);
      if (!source) return callback({});
      callback({ video: source, ...(request.audioRequested && process.platform === 'win32' ? { audio: 'loopback' } : {}) });
    } catch { callback({}); }
  });
  ipcMain.handle('studio:sources', async event => { assertSender(event); const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } }); return sources.map(s => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL(), displayId: s.display_id })); });
  ipcMain.handle('studio:select', async (event, id) => { assertSender(event); if (typeof id !== 'string') throw new Error('Invalid source.'); const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } }); selectedSource = sources.find(s => s.id === id); if (!selectedSource) throw new Error('The selected screen or window is no longer available.'); });
  ipcMain.handle('studio:track', async (event, enabled) => {
    assertSender(event); stopTracking(); if (enabled !== true || !selectedSource) return;
    // Only display captures have a reliable coordinate system. Window recordings use manual zooms.
    if (!selectedSource.id.startsWith('screen:')) return;
    const display = screen.getAllDisplays().find(d => String(d.id) === selectedSource.display_id); if (!display) return;
    const bounds = display.bounds;
    if (process.platform === 'win32') {
      const trackerPath = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'pointer.ps1') : path.join(__dirname, 'pointer.ps1');
      tracking = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', trackerPath], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      let buffer = '';
      tracking.stdout.on('data', data => {
        buffer += data.toString(); let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
          try { const [x, y, click] = JSON.parse(line); if (!Number.isFinite(x) || !Number.isFinite(y)) continue; const dip = screen.screenToDipPoint({ x, y }); sendPoint(dip.x, dip.y, !!click, bounds); } catch {}
        }
      });
      tracking.on('error', () => { tracking = undefined; });
    } else pointerTimer = setInterval(() => { const pt = screen.getCursorScreenPoint(); sendPoint(pt.x, pt.y, false, bounds); }, 33);
  });
  globalShortcut.register('CommandOrControl+Shift+R', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('studio:stop'); });
  mainWindow.on('closed', () => { stopTracking(); mainWindow = undefined; });
  if (dev) mainWindow.loadURL('http://127.0.0.1:5173'); else mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
});
app.on('will-quit', () => { stopTracking(); globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => app.quit());
