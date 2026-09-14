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
  onCommand: (callback) => {
    const handler = (_event, name, bar) => callback(name, bar);
    ipcRenderer.on("studio:command", handler);
    return () => ipcRenderer.removeListener("studio:command", handler);
  },
  native: {
    available: () => ipcRenderer.invoke("studio:native-available"),
    start: (options) => ipcRenderer.invoke("studio:native-start", options),
    command: (name) => ipcRenderer.invoke("studio:native-command", name),
    events: (folder) => ipcRenderer.invoke("studio:native-events", folder),
    onEvent: (callback) => listen("studio:native-event", callback),
    recoveries: () => ipcRenderer.invoke("studio:recoveries"),
    recovered: (folder) => ipcRenderer.invoke("studio:recovery-done", folder),
    saveProject: (folder, json) =>
      ipcRenderer.invoke("studio:project-save", folder, json),
  },
  exportFile: {
    open: (name, extension) =>
      ipcRenderer.invoke("studio:export-open", name, extension),
    write: (id, position, data) =>
      ipcRenderer.invoke("studio:export-write", id, position, data),
    close: (id, keep) => ipcRenderer.invoke("studio:export-close", id, keep),
    reveal: (file) => ipcRenderer.invoke("studio:reveal", file),
  },
});
// Used by the floating recording bar and countdown windows.
contextBridge.exposeInMainWorld("studioBar", {
  onStatus: (callback) => listen("studio:status", callback),
  command: (name) => ipcRenderer.invoke("studio:bar-command", name),
  setExpanded: (expanded) => ipcRenderer.invoke("studio:bar-expand", expanded),
});
