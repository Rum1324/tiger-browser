import { createTigerClient, type TigerClient } from '@tiger/client'
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { memoryPrefsStorage } from '../../../src/renderer/src/app/prefs'
import { ServicesProvider } from '../../../src/renderer/src/app/context'
import { type AppServices, createAppServices } from '../../../src/renderer/src/app/services'
import { createEngineState } from '../../../src/renderer/src/engine/engine-state'
import { createOverlayGuest, type OverlayGuest } from '../../../src/renderer/src/overlay/guest'
import { memoryTransportPair } from '../../../src/renderer/src/overlay/protocol'
import { FakeEngine, type FakeEngineOptions } from '../../../src/renderer/src/testing/fake-engine'
import { createFixtureServer, type FixtureServer } from '../../../src/renderer/src/testing/fixture-server'
import { buildWorld, type FixtureWorld } from '../../../src/renderer/src/testing/fixtures'

export interface World {
  world: FixtureWorld
  engine: FakeEngine
  server: FixtureServer
  client: TigerClient
  services: AppServices
  guest: OverlayGuest
  dispose(): void
}

export interface WorldOptions extends Omit<FakeEngineOptions, 'world'> {
  signedIn?: boolean
  autoStaleCheck?: boolean
  /** Prepare the world before the engine and server are built. */
  edit?: (w: FixtureWorld) => void
}

/**
 * The fixture world wired like the app: a fake engine, the fixture server, the real @tiger/client
 * and the real services, plus the overlay guest on the other end of an in-memory channel.
 */
export async function makeWorld(opts: WorldOptions = {}): Promise<World> {
  const world = await buildWorld()
  opts.edit?.(world)
  const engine = new FakeEngine({
    ...opts,
    world,
    token: opts.signedIn === false ? null : (opts.token ?? world.token),
  })
  const server = createFixtureServer(world)
  const client = createTigerClient({
    serverUrl: 'http://rig.tiger.invalid',
    bridge: engine,
    fetch: server.fetch,
    WebSocket: server.WebSocket,
    realtime: { baseBackoffMs: 20, maxBackoffMs: 50 },
  })
  const state = createEngineState(engine)
  await state.start()
  const pair = memoryTransportPair()
  const services = createAppServices({
    bridge: engine,
    engine: state,
    client,
    prefs: memoryPrefsStorage({ firstRunDone: true }),
    overlayTransport: pair.host,
    viewport: () => ({ width: 1440, height: 900 }),
    doc: null,
    autoStaleCheck: opts.autoStaleCheck ?? false,
    schedule: (cb) => {
      const t = setTimeout(cb, 0)
      return () => clearTimeout(t)
    },
  })
  const guest = createOverlayGuest(pair.guest)
  await client.start()
  if (opts.signedIn !== false) {
    await waitFor(() => client.session.store.getState().status === 'signedIn', 'sign-in')
    await waitFor(() => client.spaces.store.getState().currentSpaceId !== null, 'current Space')
    await waitFor(() => client.urlShare.store.getState().load.status === 'ready', 'item index')
  }
  return {
    world,
    engine,
    server,
    client,
    services,
    guest,
    dispose() {
      guest.dispose()
      services.dispose()
      client.dispose()
      state.dispose()
    },
  }
}

/** Poll until `check` is truthy (or stops throwing). */
export async function waitFor<T>(check: () => T, label = 'condition', timeoutMs = 3000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs
  let last: unknown = null
  for (;;) {
    try {
      const v = check()
      if (v) return v as NonNullable<T>
    } catch (e) {
      last = e
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}${last ? `: ${String(last)}` : ''}`)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
  }
}

export interface RenderedHook<T> {
  result: { current: T }
  renders: () => number
  rerender(): void
  unmount(): void
}

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Render a hook inside the services provider (jsdom). */
export function renderHook<T>(services: AppServices, hook: () => T): RenderedHook<T> {
  const result = { current: undefined as T }
  let count = 0
  function Probe(): ReactNode {
    result.current = hook()
    count++
    return null
  }
  const el = document.createElement('div')
  document.body.appendChild(el)
  let root: Root | null = null
  act(() => {
    root = createRoot(el)
    root.render(createElement(ServicesProvider, { services }, createElement(Probe)))
  })
  return {
    result,
    renders: () => count,
    rerender() {
      act(() => root?.render(createElement(ServicesProvider, { services }, createElement(Probe))))
    },
    unmount() {
      act(() => root?.unmount())
      el.remove()
    },
  }
}

/** Run a callback that changes state, and let React and pending microtasks settle. */
export async function settle(fn?: () => unknown): Promise<void> {
  await act(async () => {
    await fn?.()
    await new Promise((r) => setTimeout(r, 0))
  })
}

/** Answer the overlay guest's current surface once it appears. */
export async function guestSurface(w: World, name: string) {
  return waitFor(() => {
    const c = w.guest.store.getState().current
    return c && c.surface === name ? c : null
  }, `overlay surface ${name}`)
}
