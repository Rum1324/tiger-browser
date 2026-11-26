import type { EngineBridge, EngineEventName } from '@tiger/shared'
import { contextBridge, ipcRenderer } from 'electron'

// Kept literal (and checked against the contract by test/unit/preload-channels.test.ts) so this
// bundle does not pull zod and every schema into the UI preload.
const IPC_INVOKE_CHANNEL = 'tiger:invoke'
const IPC_EVENT_CHANNEL = 'tiger:event'

type Listener = (payload: unknown) => void
const listeners = new Map<string, Set<Listener>>()

ipcRenderer.on(IPC_EVENT_CHANNEL, (_e, event: string, payload: unknown) => {
  const set = listeners.get(event)
  if (!set) return
  for (const fn of set) {
    try {
      fn(payload)
    } catch (err) {
      console.error(`tiger: listener for ${event} threw`, err)
    }
  }
})

/**
 * `window.tiger`: the only way the UI reaches the engine. Exposed to this app's UI views only; tab
 * pages run a different preload that exposes nothing.
 */
const bridge = {
  invoke: (name: string, request?: unknown) => ipcRenderer.invoke(IPC_INVOKE_CHANNEL, name, request),
  on: (event: EngineEventName, listener: Listener) => {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function')
    let set = listeners.get(event)
    if (!set) {
      set = new Set()
      listeners.set(event, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
    }
  },
} as unknown as EngineBridge

contextBridge.exposeInMainWorld('tiger', bridge)
