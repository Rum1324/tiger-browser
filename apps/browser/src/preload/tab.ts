import { extractFromDocument } from '@tiger/extract'
import { contextBridge, ipcRenderer } from 'electron'

/**
 * Preload for web pages. It runs in Electron's isolated world and exposes nothing to the page:
 * no contextBridge API, no globals. Two jobs:
 *
 * 1. Answer capture requests from the main process by running the extractor on the live DOM. The
 *    isolated world has its own JS globals, so a page that patches prototypes cannot intercept or
 *    fake these reads (docs/research/electron-shell.md, "Page extraction").
 * 2. Make Notification.permission read 'default' until the member decides, as Chrome does; Electron
 *    only knows granted/denied, and sites offer notifications only in the 'default' state.
 */

// Literal channel names: the main process defines them in engine.ts and test/unit checks they match.
const CAPTURE_REQUEST = 'tiger:tab:capture-request'
const CAPTURE_RESULT = 'tiger:tab:capture-result'
const NOTIFICATION_STATE = 'tiger:tab:notification-state'

ipcRenderer.on(CAPTURE_REQUEST, (_e, id: string) => {
  const url = location.href
  try {
    if (document.contentType === 'application/pdf') {
      ipcRenderer.send(CAPTURE_RESULT, id, { kind: 'pdf', url })
      return
    }
    const extraction = extractFromDocument(document, url)
    ipcRenderer.send(CAPTURE_RESULT, id, { kind: 'dom', url, extraction })
  } catch (err) {
    ipcRenderer.send(CAPTURE_RESULT, id, {
      kind: 'error',
      url,
      message: err instanceof Error ? err.message : String(err),
    })
  }
})

if (location.protocol === 'https:' || location.protocol === 'http:') {
  let state = 'default'
  try {
    state = ipcRenderer.sendSync(NOTIFICATION_STATE) ?? 'default'
  } catch {
    state = 'default'
  }
  if (state === 'default') {
    contextBridge.executeInMainWorld({
      func: () => {
        if (typeof Notification === 'undefined') return
        let current: NotificationPermission = 'default'
        const request = Notification.requestPermission.bind(Notification)
        Object.defineProperty(Notification, 'permission', {
          configurable: true,
          get: () => current,
        })
        Notification.requestPermission = function requestPermission(
          callback?: NotificationPermissionCallback,
        ) {
          const p = request().then((r) => {
            current = r
            return r
          })
          if (typeof callback === 'function') p.then(callback)
          return p
        }
        const perms = navigator.permissions
        if (perms?.query) {
          const query = perms.query.bind(perms)
          perms.query = function q(desc: PermissionDescriptor) {
            return query(desc).then((st) => {
              if (desc?.name === 'notifications' && current === 'default') {
                return Object.create(st, { state: { get: () => 'prompt' } }) as PermissionStatus
              }
              return st
            })
          }
        }
      },
    })
  }
}
