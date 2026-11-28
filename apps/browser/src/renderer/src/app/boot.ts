import type { TigerClient } from '@tiger/client'
import type { EngineBridge } from '@tiger/shared'
import { useEffect, useState } from 'react'
import { createEngineState, type EngineState } from '../engine/engine-state'
import type { HostTransport } from '../overlay/protocol'
import { bindAutoSurfaces } from '../features/presenters'
import { bindDefaultShortcuts } from './default-shortcuts'
import type { PrefsStorage } from './prefs'
import { type AppServices, createAppServices } from './services'

/** What the main view needs from its environment: the real one in Electron, fakes in the rig. */
export interface AppBoot {
  bridge: EngineBridge
  createClient(serverUrl: string): TigerClient
  hostTransport(windowId: string): HostTransport
  prefs: PrefsStorage
  autoStaleCheck?: boolean
  /** Start the client (restore the session). The rig waits for its fixtures to load too. */
  startClient?: (client: TigerClient) => Promise<void>
  /** Called once the services exist (the rig drives them into a screen's state). */
  onServices?: (services: AppServices) => void
}

export type BootState =
  | { phase: 'starting' }
  | { phase: 'ready'; services: AppServices }
  | { phase: 'failed'; error: Error }

/**
 * Start the engine state, then build the services: the client depends on the server URL in the
 * engine settings, and the overlay channel on the window id, so both wait for the first read.
 * A change of server URL (Settings) rebuilds the services with a new client.
 */
export function useAppBoot(boot: AppBoot): BootState {
  const [engine, setEngine] = useState<{ state: EngineState; error: Error | null } | null>(null)
  useEffect(() => {
    const state = createEngineState(boot.bridge)
    let live = true
    state.start().then(
      () => live && setEngine({ state, error: null }),
      (e: unknown) =>
        live && setEngine({ state, error: e instanceof Error ? e : new Error(String(e)) }),
    )
    return () => {
      live = false
      state.dispose()
    }
  }, [boot.bridge])

  const [serverUrl, setServerUrl] = useState<string | null>(null)
  const [windowId, setWindowId] = useState<string | null>(null)
  useEffect(() => {
    if (!engine) return
    const read = () => {
      setServerUrl(engine.state.settings.getState().value?.serverUrl ?? null)
      setWindowId(engine.state.tabs.getState().value?.windowId ?? null)
    }
    read()
    const offs = [engine.state.settings.subscribe(read), engine.state.tabs.subscribe(read)]
    return () => {
      for (const off of offs) off()
    }
  }, [engine])

  const [services, setServices] = useState<AppServices | null>(null)
  useEffect(() => {
    if (!engine || serverUrl === null || windowId === null) return
    const client = boot.createClient(serverUrl)
    const s = createAppServices({
      bridge: boot.bridge,
      engine: engine.state,
      client,
      prefs: boot.prefs,
      overlayTransport: boot.hostTransport(windowId),
      autoStaleCheck: boot.autoStaleCheck ?? true,
    })
    const unbindShortcuts = bindDefaultShortcuts(s)
    const unbindSurfaces = bindAutoSurfaces(s)
    setServices(s)
    boot.onServices?.(s)
    void (boot.startClient ?? ((c: TigerClient) => c.start()))(client)
    return () => {
      unbindShortcuts()
      unbindSurfaces()
      s.dispose()
      client.dispose()
      setServices(null)
    }
  }, [engine, serverUrl, windowId, boot])

  if (engine?.error) return { phase: 'failed', error: engine.error }
  return services ? { phase: 'ready', services } : { phase: 'starting' }
}
