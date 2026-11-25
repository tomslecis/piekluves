// Minimal, read-only bridge: the web app only learns it runs on desktop and when to lock.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('piekluvesDesktop', {
  platform: process.platform,
  onLock: (cb) => ipcRenderer.on('lock', () => cb()),
});
