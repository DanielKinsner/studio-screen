const { contextBridge, ipcRenderer } = require('electron');
const listen = (channel, callback) => { const handler = (_event, value) => callback(value); ipcRenderer.on(channel, handler); return () => ipcRenderer.removeListener(channel, handler); };
contextBridge.exposeInMainWorld('studioDesktop', {
  sources: () => ipcRenderer.invoke('studio:sources'),
  selectSource: id => ipcRenderer.invoke('studio:select', id),
  track: enabled => ipcRenderer.invoke('studio:track', enabled),
  onPoint: callback => listen('studio:point', callback),
  onStop: callback => listen('studio:stop', callback),
});
