'use strict';
// Preload for web tabs (sandboxed, context-isolated). It does exactly one thing:
// Electron only exposes notification permission as 'granted' or 'denied' (verified: with no check
// handler a fresh profile reports 'granted', with one it reports 'denied'), while Chrome reports
// 'default' until the user decides. Sites such as Gmail and Slack only offer "enable desktop
// notifications" in the 'default' state, so without this shim the notification check is meaningless.
const { contextBridge, ipcRenderer } = require('electron');

let state = 'default';
try { state = ipcRenderer.sendSync('perm:notifications', location.origin) || 'default'; } catch { /* ignore */ }

if (state === 'default' && location.protocol === 'https:') {
  contextBridge.executeInMainWorld({
    func: () => {
      if (typeof Notification === 'undefined') return;
      let current = 'default';
      const origRequest = Notification.requestPermission.bind(Notification);
      Object.defineProperty(Notification, 'permission', { configurable: true, get: () => current });
      Notification.requestPermission = function requestPermission(cb) {
        const p = origRequest().then(r => { current = r; return r; });
        if (typeof cb === 'function') p.then(cb);
        return p;
      };
      if (navigator.permissions && navigator.permissions.query) {
        const origQuery = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = function query(desc) {
          return origQuery(desc).then(st => {
            if (desc && desc.name === 'notifications' && current === 'default') {
              return Object.create(st, { state: { get: () => 'prompt' } });
            }
            return st;
          });
        };
      }
    },
  });
}
