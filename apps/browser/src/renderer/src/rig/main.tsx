import { createTigerClient, type TigerClient } from '@tiger/client'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '../app/App'
import type { AppBoot } from '../app/boot'
import { memoryPrefsStorage } from '../app/prefs'
import type { AppServices } from '../app/services'
import { translator } from '../i18n'
import { createOverlayGuest, type OverlayGuest } from '../overlay/guest'
import { OverlayRoot } from '../overlay/OverlayRoot'
import { Placeholder } from '../overlay/placeholders'
import { memoryTransportPair } from '../overlay/protocol'
import { FakeEngine } from '../testing/fake-engine'
import { createFixtureServer, type FixtureServer } from '../testing/fixture-server'
import { buildWorld, type FixtureWorld } from '../testing/fixtures'
import '../theme'
import { RIG_SCREENS, type RigContext, type RigScreen, rigScreen } from './screens'

/**
 * The visual test rig: the renderer in plain Chromium, no Electron. A fake engine and the real
 * @tiger/client over the fixture server stand in for the world; `?screen=<name>&theme=light|dark`
 * opens one catalogued screen in one state. The native page view is drawn as a stand-in card at the
 * bounds the UI reported, and the overlay view as a layer at the bounds it was raised with, so a
 * screenshot shows the window as the member would see it. `<html data-rig-ready>` is set once the
 * screen has settled (test/rig/shots.mts waits for it).
 */

declare global {
  interface Window {
    __rig?: { screens: string[]; ctx: RigContext | null; error: string | null }
  }
}

const params = new URLSearchParams(location.search)
const theme = params.get('theme') === 'dark' ? 'dark' : 'light'
window.__rig = { screens: RIG_SCREENS.map((s) => s.name), ctx: null, error: null }

function fail(message: string) {
  if (window.__rig) window.__rig.error = message
  document.documentElement.dataset.rigError = message
}

async function settleFrames() {
  for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(() => r(null)))
  await new Promise((r) => setTimeout(r, 50))
  await document.fonts?.ready
}

async function waitFor(check: () => boolean, label: string, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > end) throw new Error(`rig: timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

async function startClient(client: TigerClient, signedIn: boolean) {
  await client.start()
  await loaded(client, signedIn)
}

/** Wait for the first loads the screens draw from (the session, index, threads, items, models). */
async function loaded(client: TigerClient, signedIn: boolean) {
  if (!signedIn) {
    await waitFor(() => client.session.store.getState().status === 'signedOut', 'signed out')
    return
  }
  await waitFor(() => client.session.store.getState().status === 'signedIn', 'sign-in')
  await waitFor(() => client.urlShare.store.getState().load.status === 'ready', 'item index')
  await waitFor(() => client.threads.store.getState().load.status === 'ready', 'threads')
  await waitFor(() => client.items.store.getState().load.status === 'ready', 'items')
  await waitFor(() => client.models.store.getState().load.status === 'ready', 'models')
}

function PageStandIn({ engine, world }: { engine: FakeEngine; world: FixtureWorld }) {
  const [, setN] = useState(0)
  useEffect(() => engine.observe(() => setN((n) => n + 1)), [engine])
  const b = engine.pageBounds?.bounds
  const tab = engine.activeTab()
  if (!b || !tab) return null
  const page = Object.values(world.pages).find((p) => p.url === tab.url)
  const style: CSSProperties = {
    position: 'fixed',
    left: b.x,
    top: b.y,
    width: b.width,
    height: b.height,
    borderRadius: engine.pageBounds?.cornerRadius ?? 0,
    overflow: 'hidden',
    background: 'var(--mock-sheet, #fff)',
    color: 'var(--mock-ink, #222)',
    font: '14px/1.7 var(--font-ui, sans-serif)',
    padding: 32,
    boxSizing: 'border-box',
    whiteSpace: 'pre-wrap',
  }
  return (
    <div data-rig-page="" style={style}>
      <strong>{page?.title ?? tab.title}</strong>
      {'\n\n'}
      {page?.markdown ?? tab.url}
    </div>
  )
}

function OverlayLayer({ engine, guest, locale }: { engine: FakeEngine; guest: OverlayGuest; locale: 'ja' | 'en' }) {
  const [, setN] = useState(0)
  useEffect(() => engine.observe(() => setN((n) => n + 1)), [engine])
  const t = useMemo(() => translator(locale), [locale])
  const { open, bounds } = engine.overlay
  // `transform` makes the layer the containing block of the overlay's fixed-position root, as the
  // overlay view's own viewport would be.
  const style: CSSProperties = {
    position: 'fixed',
    left: bounds?.x ?? 0,
    top: bounds?.y ?? 0,
    width: bounds?.width ?? '100vw',
    height: bounds?.height ?? '100vh',
    transform: 'translateZ(0)',
    visibility: open ? 'visible' : 'hidden',
  }
  return (
    <div data-rig-overlay="" style={style}>
      <OverlayRoot guest={guest} fallback={(name) => <Placeholder name={name} t={t} bridge={engine} />} />
    </div>
  )
}

async function mountApp(screen: RigScreen, world: FixtureWorld, engine: FakeEngine, server: FixtureServer) {
  const pair = memoryTransportPair()
  const guest = createOverlayGuest(pair.guest)
  let client: TigerClient | null = null
  let services: AppServices | null = null
  const signedIn = screen.signedIn !== false
  const boot: AppBoot = {
    bridge: engine,
    createClient: () => {
      client = createTigerClient({ serverUrl: world.settings.serverUrl, bridge: engine, fetch: server.fetch, WebSocket: server.WebSocket })
      return client
    },
    hostTransport: () => pair.host,
    prefs: memoryPrefsStorage({ firstRunDone: screen.firstRunDone ?? true, panelOpen: screen.panelOpen ?? false }),
    autoStaleCheck: false,
    startClient: (c) => startClient(c, signedIn),
    onServices: (s) => {
      services = s
    },
  }
  const el = document.getElementById('root') as HTMLElement
  createRoot(el).render(
    <>
      <App boot={boot} />
      <PageStandIn engine={engine} world={world} />
      <OverlayLayer engine={engine} guest={guest} locale={engine.settings.locale} />
    </>,
  )
  await waitFor(() => services !== null && client !== null, 'services')
  const s = services as unknown as AppServices
  const c = client as unknown as TigerClient
  await loaded(c, signedIn)
  if (screen.route) s.router.go(screen.route)
  const ctx: RigContext = { world, engine, server, client: c, services: s }
  if (window.__rig) window.__rig.ctx = ctx
  await screen.setup?.(ctx)
}

async function mountHarness(screen: RigScreen, world: FixtureWorld, engine: FakeEngine, server: FixtureServer) {
  // The harness reads window.tiger when its modules load.
  window.tiger = engine
  document.documentElement.dataset.view = 'main'
  const [{ Harness }] = await Promise.all([import('../dev/harness/Harness'), import('../dev/harness/styles.css')])
  const client = createTigerClient({ serverUrl: world.settings.serverUrl, bridge: engine, fetch: server.fetch, WebSocket: server.WebSocket })
  await startClient(client, screen.signedIn !== false)
  createRoot(document.getElementById('root') as HTMLElement).render(<Harness client={client} />)
  const ctx: RigContext = { world, engine, server, client, services: null }
  if (window.__rig) window.__rig.ctx = ctx
  await screen.setup?.(ctx)
}

async function main() {
  const name = params.get('screen') ?? ''
  const screen = rigScreen(name)
  if (!screen) {
    document.body.textContent = `Unknown screen "${name}". Screens: ${RIG_SCREENS.map((s) => s.name).join(', ')}`
    fail(`unknown screen ${name}`)
    return
  }
  document.documentElement.dataset.view = 'main'
  const world = await buildWorld()
  world.settings.theme = theme
  const engine = new FakeEngine({
    world,
    tabs: screen.tabs ?? [{ page: '', active: true }],
    privateWindow: screen.privateWindow ?? false,
    token: screen.signedIn === false ? null : world.token,
  })
  const server = createFixtureServer(world)
  if (screen.kind === 'harness') await mountHarness(screen, world, engine, server)
  else await mountApp(screen, world, engine, server)
  await settleFrames()
  document.documentElement.dataset.rigScreen = screen.name
  document.documentElement.dataset.rigReady = 'true'
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
