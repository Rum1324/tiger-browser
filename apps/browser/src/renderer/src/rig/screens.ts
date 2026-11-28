import type { TigerClient } from '@tiger/client'
import type { Route } from '../app/router'
import type { AppServices } from '../app/services'
import type { FakeEngine, FakeTabSpec } from '../testing/fake-engine'
import type { FixtureServer } from '../testing/fixture-server'
import { type FixtureWorld, uid } from '../testing/fixtures'

/**
 * The rig's catalogue: every screen it can open by name, in a given state. A designed screen gets an
 * entry here named like its design shot (design/final/shots/<name>.png) so the two can be compared
 * side by side. `harness/*` screens draw the developer harness; `app/*` screens draw the product
 * shell (placeholders until the designed components land).
 */
export interface RigContext {
  world: FixtureWorld
  engine: FakeEngine
  server: FixtureServer
  client: TigerClient
  /** Product-shell screens only. */
  services: AppServices | null
}

export interface RigScreen {
  name: string
  kind: 'app' | 'harness'
  description: string
  tabs?: FakeTabSpec[]
  privateWindow?: boolean
  signedIn?: boolean
  route?: Route
  panelOpen?: boolean
  firstRunDone?: boolean
  /** Bring the stores into the screen's state (after sign-in and the first loads). */
  setup?: (ctx: RigContext) => Promise<void> | void
}

const BROWSING: FakeTabSpec[] = [
  { page: 'pitch', active: true },
  { page: 'notion' },
  { page: 'slack' },
  { page: 'news' },
  { page: 'gmail' },
  { page: 'hireplan' },
  { page: 'bank', pinned: true },
]

const activate = (key: string): FakeTabSpec[] =>
  BROWSING.map((t) => ({ ...t, active: t.page === key }))

const waitUntil = async (check: () => boolean, timeoutMs = 3000) => {
  const end = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > end) throw new Error('rig: state not reached')
    await new Promise((r) => setTimeout(r, 10))
  }
}

export const RIG_SCREENS: RigScreen[] = [
  // ── The developer harness (proves the rig before the designed screens exist) ──
  {
    name: 'harness/signed-out',
    kind: 'harness',
    description: 'Harness, signed out: the dev sign-in form.',
    tabs: BROWSING,
    signedIn: false,
  },
  {
    name: 'harness/signed-in',
    kind: 'harness',
    description: 'Harness, signed in to 資金調達 2027 with shared items and threads.',
    tabs: BROWSING,
  },
  {
    name: 'harness/share-preview',
    kind: 'harness',
    description: 'Harness with the share preview of the news article open.',
    tabs: activate('news'),
    setup: ({ client, engine }) => client.share.begin(engine.state.activeTabId as string),
  },
  {
    name: 'harness/capture-blocked',
    kind: 'harness',
    description: 'Harness after trying to capture the mail tab: refused by the blocklist.',
    tabs: activate('gmail'),
    setup: async () => {
      await waitUntil(() => !!document.querySelector('[data-testid="capture"]'))
      // The harness keeps the capture result in component state: press its button like a member.
      const button = document.querySelector<HTMLButtonElement>('[data-testid="capture"]')
      if (button) {
        button.disabled = false
        button.click()
      }
    },
  },

  // ── The product shell, one entry per page state and surface ──
  { name: 'app/page-fresh', kind: 'app', description: 'Pitch deck, shared in this Space (v2).', tabs: activate('pitch') },
  {
    name: 'app/page-stale',
    kind: 'app',
    description: 'Capital policy memo: the page changed after it was shared.',
    tabs: activate('notion'),
    setup: async ({ services, engine }) => {
      await services?.pageShare.checkStale(engine.state.activeTabId as string)
    },
  },
  { name: 'app/page-local', kind: 'app', description: 'News article that stays on this Mac.', tabs: activate('news') },
  { name: 'app/page-elsewhere', kind: 'app', description: 'Hiring plan, shared in 採用 only.', tabs: activate('hireplan') },
  { name: 'app/page-blocked', kind: 'app', description: 'Mail: cannot be shared.', tabs: activate('gmail') },
  {
    name: 'app/page-private',
    kind: 'app',
    description: 'A private window: no hue, nothing shareable.',
    tabs: [{ page: 'news', active: true }],
    privateWindow: true,
  },
  {
    name: 'app/page-pending',
    kind: 'app',
    description: 'The item index is still loading.',
    tabs: activate('pitch'),
    setup: ({ client, server }) => {
      server.holdRoute('listItemIndex')
      client.urlShare.reset()
      void client.urlShare.start(client.spaces.store.getState().list.map((s) => s.id))
    },
  },
  {
    name: 'app/page-just-shared',
    kind: 'app',
    description: 'Right after sharing the news article (with undo).',
    tabs: activate('news'),
    setup: async ({ client, engine }) => {
      await client.share.begin(engine.state.activeTabId as string)
      await client.share.confirm()
    },
  },
  {
    name: 'app/ask-panel',
    kind: 'app',
    description: 'Ask panel open on the private thread, an answer still streaming.',
    tabs: activate('pitch'),
    panelOpen: true,
  },
  { name: 'app/space-home', kind: 'app', description: 'Space home.', tabs: BROWSING, route: { name: 'space-home', section: 'overview' } },
  { name: 'app/settings', kind: 'app', description: 'Settings.', tabs: BROWSING, route: { name: 'settings', section: 'general' } },
  { name: 'app/item', kind: 'app', description: 'A shared item.', tabs: BROWSING, route: { name: 'item', itemId: uid(202) } },
  { name: 'app/new-tab', kind: 'app', description: 'A new tab.', tabs: [...BROWSING.map((t) => ({ ...t, active: false })), { page: '', active: true }] },
  { name: 'app/sign-in', kind: 'app', description: 'Signed out, sign-in surface.', tabs: BROWSING, signedIn: false, route: { name: 'sign-in' } },
  { name: 'app/first-run', kind: 'app', description: 'First run.', tabs: [{ page: '', active: true }], signedIn: false, firstRunDone: false },
  {
    name: 'app/palette',
    kind: 'app',
    description: 'Command palette open over the page.',
    tabs: activate('pitch'),
    setup: ({ services }) => {
      if (services) services.shortcuts.dispatch('toggle-command')
    },
  },
  {
    name: 'app/share-sheet',
    kind: 'app',
    description: 'Share sheet with the preview of the news article.',
    tabs: activate('news'),
    setup: ({ services }) => {
      if (services) services.shortcuts.dispatch('share-tab')
    },
  },
]

export function rigScreen(name: string): RigScreen | null {
  return RIG_SCREENS.find((s) => s.name === name) ?? null
}
