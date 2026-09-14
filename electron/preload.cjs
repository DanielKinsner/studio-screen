const { contextBridge, ipcRenderer } = require("electron");
const listen = (channel, callback) => {
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
contextBridge.exposeInMainWorld("studioDesktop", {
  sources: () => ipcRenderer.invoke("studio:sources"),
  selectSource: (id) => ipcRenderer.invoke("studio:select", id),
  track: (enabled) => ipcRenderer.invoke("studio:track", enabled),
  onPoint: (callback) => listen("studio:point", callback),
  onStop: (callback) => listen("studio:stop", callback),
  recordingUi: (state) => ipcRenderer.invoke("studio:recording-ui", state),
  onCommand: (callback) => listen("studio:command", callback),
});
// Used by the floating recording bar and countdown windows.
contextBridge.exposeInMainWorld("studioBar", {
  onStatus: (callback) => listen("studio:status", callback),
  command: (name) => ipcRenderer.invoke("studio:bar-command", name),
  setExpanded: (expanded) => ipcRenderer.invoke("studio:bar-expand", expanded),
});
