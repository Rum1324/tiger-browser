import type { EngineBridge, EngineEventName } from '@tiger/shared'
import { contextBridge, ipcRenderer } from 'electron'
import { createEventHub } from './events'

// Kept literal (and checked against the contract by test/unit/preload-channels.test.ts) so this
// bundle does not pull zod and every schema into the UI preload.
const IPC_INVOKE_CHANNEL = 'tiger:invoke'
const IPC_EVENT_CHANNEL = 'tiger:event'

type Listener = (payload: unknown) => void
const hub = createEventHub()

ipcRenderer.on(IPC_EVENT_CHANNEL, (_e, event: string, payload: unknown) => {
  hub.dispatch(event, payload)
})

/**
 * `window.tiger`: the only way the UI reaches the engine. Exposed to this app's UI views only; tab
 * pages run a different preload that exposes nothing.
 */
const bridge = {
  invoke: (name: string, request?: unknown) =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNEL, name, request),
  on: (event: EngineEventName, listener: Listener) => hub.on(event, listener),
} as unknown as EngineBridge

contextBridge.exposeInMainWorld('tiger', bridge)
