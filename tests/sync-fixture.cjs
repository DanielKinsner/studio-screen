// Controlled display fixture for the idle-gated native A/V sync test.
const { app, BrowserWindow, screen } = require("electron");
const path = require("node:path");
app.setPath("userData", path.join(__dirname, ".profile-sync-fixture"));
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    ...screen.getPrimaryDisplay().bounds,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: "#000000",
    webPreferences: { backgroundThrottling: false },
  });
  await window.loadURL("data:text/html,<title>Studio Screen Sync Fixture</title>");
  window.show();
});
app.on("window-all-closed", () => app.quit());
