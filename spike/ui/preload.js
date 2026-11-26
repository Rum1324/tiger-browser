'use strict';
// Bridge for the browser chrome UI only (tabs never get this preload).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spike', {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  onFocusAddress: (fn) => ipcRenderer.on('focus-address', () => fn()),
  newTab: (url, checkId) => ipcRenderer.send('tab:new', url || null, checkId || null),
  activate: (id) => ipcRenderer.send('tab:activate', id),
  closeTab: (id) => ipcRenderer.send('tab:close', id),
  go: (input) => ipcRenderer.send('nav:go', input),
  back: () => ipcRenderer.send('nav:back'),
  forward: () => ipcRenderer.send('nav:forward'),
  reload: () => ipcRenderer.send('nav:reload'),
  openCheck: (id) => ipcRenderer.send('check:open', id),
  setCheck: (id, patch) => ipcRenderer.send('check:set', id, patch),
  exportTest: () => ipcRenderer.invoke('check:exportTest'),
  saveReport: () => ipcRenderer.invoke('report:save'),
  copyReport: () => ipcRenderer.invoke('report:copy'),
  revealReport: () => ipcRenderer.send('report:reveal'),
  setPanel: (v) => ipcRenderer.send('panel:set', v),
});
