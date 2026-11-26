import type { GoogleConnection, GoogleFlowError } from '@tiger/shared'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { ClientContext } from '../load'

/**
 * The member's Google account link for the Docs exit. Everything runs in the engine: tokens never
 * reach this layer or the server. `phase` is `connecting` while the consent flow waits in the system
 * browser; `cancel()` stops waiting.
 */
export interface GoogleState {
  connection: GoogleConnection | null
  phase: 'idle' | 'connecting' | 'disconnecting'
  /** Why the last connect did not complete, or null. Cleared by the next attempt. */
  error: GoogleFlowError | null
}

export interface GoogleController {
  store: StoreApi<GoogleState>
  refresh(): Promise<void>
  /** Resolves true when the account is connected afterwards. */
  connect(): Promise<boolean>
  /** Stop waiting for a consent flow the member abandoned. The pending connect resolves `cancelled`. */
  cancel(): Promise<void>
  disconnect(): Promise<void>
  /** Follow `google.changed` from the engine. Returns the unsubscribe. */
  attach(): () => void
}

export function createGoogle(ctx: ClientContext): GoogleController {
  const store = createStore<GoogleState>()(() => ({
    connection: null,
    phase: 'idle',
    error: null,
  }))

  const controller: GoogleController = {
    store,
    async refresh() {
      try {
        store.setState({ connection: await ctx.bridge.invoke('google.status') })
      } catch {
        // The engine always answers; keep what is known.
      }
    },
    async connect() {
      store.setState({ phase: 'connecting', error: null })
      try {
        const r = await ctx.bridge.invoke('google.connect')
        store.setState({ connection: r.connection, error: r.error, phase: 'idle' })
        return r.error === null && r.connection.connected
      } catch {
        store.setState({ phase: 'idle', error: 'failed' })
        return false
      }
    },
    async cancel() {
      await ctx.bridge.invoke('google.cancel')
    },
    async disconnect() {
      store.setState({ phase: 'disconnecting', error: null })
      try {
        store.setState({ connection: await ctx.bridge.invoke('google.disconnect') })
      } finally {
        store.setState({ phase: 'idle' })
      }
    },
    attach() {
      return ctx.bridge.on('google.changed', (connection) => store.setState({ connection }))
    },
  }
  return controller
}
