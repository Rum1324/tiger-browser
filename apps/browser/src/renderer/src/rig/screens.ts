import type { TigerClient } from '@tiger/client'
import type { Download } from '@tiger/shared'
import type { UiPrefs } from '../app/prefs'
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
  /** UI prefs at boot (sidebar collapsed, widths). */
  prefs?: Partial<UiPrefs>
  /** A theme the screen is drawn in whatever `?theme=` says (the dark design shots). */
  theme?: 'light' | 'dark'
  /** The design shot this screen is compared with: design/final/shots/<shot>.png. */
  shot?: string
  /** Change the fixture world before the engine and the server are built from it. */
  edit?: (world: FixtureWorld) => void
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
  {
    name: 'app/page-fresh',
    kind: 'app',
    description: 'Pitch deck, shared in this Space (v2).',
    tabs: activate('pitch'),
  },
  {
    name: 'app/page-stale',
    kind: 'app',
    description: 'Capital policy memo: the page changed after it was shared.',
    tabs: activate('notion'),
    setup: async ({ services, engine }) => {
      await services?.pageShare.checkStale(engine.state.activeTabId as string)
    },
  },
  {
    name: 'app/page-local',
    kind: 'app',
    description: 'News article that stays on this Mac.',
    tabs: activate('news'),
  },
  {
    name: 'app/page-elsewhere',
    kind: 'app',
    description: 'Hiring plan, shared in 採用 only.',
    tabs: activate('hireplan'),
  },
  {
    name: 'app/page-blocked',
    kind: 'app',
    description: 'Mail: cannot be shared.',
    tabs: activate('gmail'),
  },
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
  {
    name: 'app/space-home',
    kind: 'app',
    description: 'Space home.',
    tabs: BROWSING,
    route: { name: 'space-home', section: 'overview' },
  },
  {
    name: 'app/settings',
    kind: 'app',
    description: 'Settings.',
    tabs: BROWSING,
    route: { name: 'settings', section: 'general' },
  },
  {
    name: 'app/item',
    kind: 'app',
    description: 'A shared item.',
    tabs: BROWSING,
    route: { name: 'item', itemId: uid(202) },
  },
  {
    name: 'app/new-tab',
    kind: 'app',
    description: 'A new tab.',
    tabs: [...BROWSING.map((t) => ({ ...t, active: false })), { page: '', active: true }],
  },
  {
    name: 'app/sign-in',
    kind: 'app',
    description: 'Signed out, sign-in surface.',
    tabs: BROWSING,
    signedIn: false,
    route: { name: 'sign-in' },
  },
  {
    name: 'app/first-run',
    kind: 'app',
    description: 'First run.',
    tabs: [{ page: '', active: true }],
    signedIn: false,
    firstRunDone: false,
  },
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

// ── The design shots (design/final/shots/<name>.png), one entry each ─────────
//
// Each entry brings the app into the state its shot shows, as far as the fixture world and the
// contracts allow (DESIGN.md 14 lists what the code cannot do yet). Until the designed components
// land, these draw the plain placeholders; `pnpm rig:compare <name>` puts both side by side.

const activeTab = (ctx: RigContext) => ctx.engine.state.activeTabId as string
const svc = (ctx: RigContext) => {
  if (!ctx.services) throw new Error('rig: an app screen without services')
  return ctx.services
}
const overlayShown = (ctx: RigContext, surface: string) =>
  waitUntil(() => svc(ctx).overlay.store.getState().open?.surface === surface)

const messagesOf = (w: FixtureWorld) => w.messages[w.ids.privateThread] ?? []
const settleAnswer = (
  w: FixtureWorld,
  patch: Partial<NonNullable<ReturnType<typeof messagesOf>[number]>>,
) => {
  w.messages[w.ids.privateThread] = messagesOf(w).map((m) =>
    m.id === w.ids.streamingAnswer ? { ...m, streamSeq: null, ...patch } : m,
  )
}

const MANY_TABS: FakeTabSpec[] = [
  ...BROWSING,
  ...Array.from({ length: 33 }, (_, i) => ({
    page: `https://example.com/research/${i + 1}`,
  })),
]

const ALL_DOWNLOADS: Download[] = (
  ['progressing', 'paused', 'completed', 'cancelled', 'interrupted'] as const
).map((state, i) => ({
  id: `dl-${state}`,
  url: `https://files.example.com/${state}.pdf`,
  filename: [
    '事業計画_2027.pdf',
    '議事録_1125.docx',
    '介護報酬改定の概要.pdf',
    'ロゴ一式.zip',
    '決算書_2025.pdf',
  ][i] as string,
  savePath: state === 'completed' ? `/Users/saeki/Downloads/${state}.pdf` : null,
  state,
  receivedBytes: state === 'completed' ? 2_412_000 : 820_000,
  totalBytes: 2_412_000,
  startedAt: new Date(Date.parse('2026-11-26T03:14:00.000Z') - (i + 1) * 60_000).toISOString(),
}))

interface ShotSpec extends Omit<RigScreen, 'name' | 'kind' | 'shot'> {}

const shot = (name: string, spec: ShotSpec): RigScreen => ({
  name,
  kind: 'app',
  shot: name,
  ...spec,
})
const dark = (name: string, base: RigScreen): RigScreen => ({
  ...base,
  name,
  shot: name,
  theme: 'dark',
  description: `${base.description} Dark theme.`,
})

const browse = shot('01-browse', {
  description: 'A Google Doc the Space holds at v2, unchanged: fresh.',
  tabs: activate('pitch'),
})
const askPanel = shot('02-ask-panel', {
  description: 'The private thread with a cited answer, the panel open.',
  tabs: activate('pitch'),
  panelOpen: true,
  edit: (w) => settleAnswer(w, { status: 'complete' }),
})
const spaceHome = shot('04-space-home', {
  description: 'Space home: the ledger and the team thread.',
  tabs: BROWSING,
  route: { name: 'space-home', section: 'overview' },
})
const privateWindow = shot('05b-private-window', {
  description: 'A private window: no Space, no hue, no shelf, no ask button.',
  tabs: [{ page: '', active: true }],
  privateWindow: true,
})
const shareThread = shot('17-share-thread-confirm', {
  description: 'Sharing the private thread: the attached question is still undecided.',
  tabs: activate('pitch'),
  panelOpen: true,
  edit: (w) => settleAnswer(w, { status: 'complete' }),
  setup: async (ctx) => {
    const { shareThreadActions } = await import('../features/share-thread')
    void shareThreadActions(ctx.client, svc(ctx).overlay).present(ctx.world.ids.privateThread)
    await overlayShown(ctx, 'share-thread')
  },
})
const settings = shot('19-settings', {
  description: 'Settings.',
  tabs: BROWSING,
  route: { name: 'settings', section: 'general' },
})
const itemDetail = shot('21-item-detail', {
  description: 'A shared item with its versions.',
  tabs: BROWSING,
  route: { name: 'item', itemId: uid(202) },
})

export const DESIGN_SCREENS: RigScreen[] = [
  browse,
  askPanel,
  shot('03-share-preview', {
    description: 'First share of a page: the preview in the sheet.',
    tabs: activate('news'),
    setup: async (ctx) => {
      svc(ctx).shortcuts.dispatch('share-tab')
      await overlayShown(ctx, 'share')
      await waitUntil(() => ctx.client.share.store.getState().phase === 'preview')
    },
  }),
  shot('03b-share-update', {
    description: 'A new version of a changed page: the preview with the changed lines.',
    tabs: activate('notion'),
    setup: async (ctx) => {
      await svc(ctx).pageShare.checkStale(activeTab(ctx))
      svc(ctx).shortcuts.dispatch('share-tab')
      await overlayShown(ctx, 'share')
      await waitUntil(() => ctx.client.share.store.getState().phase === 'preview')
    },
  }),
  shot('03c-crossing', {
    description: 'The moment after the server answered a share (motion frozen as its end state).',
    tabs: activate('news'),
    setup: async (ctx) => {
      await ctx.client.share.begin(
        activeTab(ctx),
        ctx.client.spaces.store.getState().currentSpaceId,
      )
      await ctx.client.share.confirm()
    },
  }),
  shot('03c-shared', {
    description: 'Just shared: closed ring, the item first on the shelf, undo in the capsule.',
    tabs: activate('news'),
    setup: async (ctx) => {
      await ctx.client.share.begin(
        activeTab(ctx),
        ctx.client.spaces.store.getState().currentSpaceId,
      )
      await ctx.client.share.confirm()
    },
  }),
  spaceHome,
  shot('05-cannot-share', {
    description: 'A bank page: blocked, with the reason popover.',
    tabs: activate('bank'),
    setup: async (ctx) => {
      const { pageShareActions } = await import('../features/page-share')
      void pageShareActions(svc(ctx), () => activeTab(ctx)).showBlockedReason()
      await overlayShown(ctx, 'blocked-reason')
    },
  }),
  privateWindow,
  shot('06-first-run', {
    description: 'First run.',
    tabs: [{ page: '', active: true }],
    firstRunDone: false,
  }),
  dark('07-dark-01-browse', browse),
  dark('07-dark-02-ask-panel', askPanel),
  dark('07-dark-04-space-home', spaceHome),
  dark('07-dark-05b-private-window', privateWindow),
  shot('08-command', {
    description: 'The command palette over a news page.',
    tabs: activate('news'),
    setup: async (ctx) => {
      svc(ctx).shortcuts.dispatch('toggle-command')
      await overlayShown(ctx, 'palette')
    },
  }),
  shot('09-attach-preview', {
    description: 'The attach sheet for the news article.',
    tabs: activate('news'),
    panelOpen: true,
    edit: (w) => settleAnswer(w, { status: 'complete' }),
    setup: async (ctx) => {
      const { attachActions } = await import('../features/attach')
      void attachActions(ctx.client, svc(ctx).overlay, () => activeTab(ctx)).present()
      await overlayShown(ctx, 'attach')
    },
  }),
  shot('09b-attached', {
    description: 'The news article attached to the next question: dashed frame and chips.',
    tabs: activate('news'),
    panelOpen: true,
    edit: (w) => settleAnswer(w, { status: 'complete' }),
    setup: async (ctx) => {
      const thread = await ctx.client.threads.ensurePrivateThread()
      if (!thread) throw new Error('rig: no private thread')
      await ctx.client.threads.beginAttach(thread.id, activeTab(ctx))
      ctx.client.threads.confirmAttach()
    },
  }),
  shot('10a-stale', {
    description: 'The capital policy memo changed after it was shared: stale.',
    tabs: activate('notion'),
    setup: async (ctx) => {
      await svc(ctx).pageShare.checkStale(activeTab(ctx))
    },
  }),
  shot('10b-shared-elsewhere', {
    description: 'The hiring plan, shared in 採用 only.',
    tabs: activate('hireplan'),
  }),
  shot('10c-after-navigation', {
    description: 'A page that stays on this Mac (local) after navigating away from a shared one.',
    tabs: activate('news'),
  }),
  shot('11-unshare-confirm', {
    description: 'Unsharing an item from the ledger: the confirmation.',
    tabs: BROWSING,
    route: { name: 'space-home', section: 'items' },
    setup: async (ctx) => {
      const item = ctx.client.items.store.getState().items[0]
      if (!item) throw new Error('rig: no items')
      void svc(ctx).overlay.open(
        'confirm',
        {
          title: { key: 'ledger.unshareTitle' },
          body: { key: 'ledger.unshareBody' },
          subject: item.title,
          confirm: { key: 'ledger.unshareConfirm' },
          destructive: true,
        },
        { mode: 'modal' },
      ).outcome
      await overlayShown(ctx, 'confirm')
    },
  }),
  shot('11b-citation-unavailable', {
    description: 'An answer whose cited source was unshared.',
    tabs: activate('news'),
    panelOpen: true,
    edit: (w) => {
      settleAnswer(w, { status: 'complete' })
      w.messages[w.ids.privateThread] = messagesOf(w).map((m) => ({
        ...m,
        citations: m.citations.map((c) => ({ ...c, available: false })),
      }))
    },
  }),
  shot('12-model-menu', {
    description: 'The model menu, by receiving company.',
    tabs: activate('pitch'),
    panelOpen: true,
    edit: (w) => settleAnswer(w, { status: 'complete' }),
    setup: async (ctx) => {
      const { presentModelPicker } = await import('../features/presenters')
      void presentModelPicker(svc(ctx))
      await overlayShown(ctx, 'model-picker')
    },
  }),
  shot('13a-streaming-with-stop', {
    description: 'An answer still streaming, with stop.',
    tabs: activate('pitch'),
    panelOpen: true,
  }),
  shot('13b-answer-failed', {
    description: 'An answer that failed: the budget is used up.',
    tabs: activate('pitch'),
    panelOpen: true,
    edit: (w) => settleAnswer(w, { status: 'error', errorCode: 'budget_exceeded' }),
  }),
  shot('13c-answer-stopped', {
    description: 'An answer the member stopped.',
    tabs: activate('pitch'),
    panelOpen: true,
    edit: (w) => settleAnswer(w, { status: 'error', errorCode: 'ai_aborted' }),
  }),
  shot('14-many-tabs', {
    description: 'Forty tabs.',
    tabs: MANY_TABS,
  }),
  shot('14b-sidebar-collapsed', {
    description: 'The sidebar as a rail.',
    tabs: activate('pitch'),
    prefs: { sidebarCollapsed: true },
  }),
  shot('15a-permission-prompt', {
    description: 'A meeting page asks for the microphone.',
    tabs: [
      ...BROWSING.map((t) => ({ ...t, active: false })),
      { page: 'https://meet.example.com/abc-defg', active: true },
    ],
    setup: async (ctx) => {
      ctx.engine.emit('permission.request', {
        requestId: 'rig-mic',
        tabId: activeTab(ctx),
        origin: 'https://meet.example.com',
        permission: 'microphone',
      })
      await overlayShown(ctx, 'permission')
    },
  }),
  shot('15b-downloads', {
    description: 'The downloads list with every state.',
    tabs: activate('pitch'),
    edit: (w) => {
      w.downloads = ALL_DOWNLOADS
    },
    setup: async (ctx) => {
      svc(ctx).shortcuts.dispatch('open-downloads')
      await overlayShown(ctx, 'downloads')
    },
  }),
  shot('15c-find-in-page', {
    description: 'Find in page.',
    tabs: activate('pitch'),
    setup: async (ctx) => {
      svc(ctx).shortcuts.dispatch('find')
      svc(ctx).find.setText('調達')
    },
  }),
  shot('15d-notice', {
    description: 'The notice: a download finished.',
    tabs: activate('pitch'),
    setup: async (ctx) => {
      const running = ctx.engine.downloads.find((d) => d.state === 'progressing')
      if (!running) throw new Error('rig: no running download')
      ctx.engine.downloads = ctx.engine.downloads.map((d) =>
        d.id === running.id ? { ...d, state: 'completed', receivedBytes: d.totalBytes } : d,
      )
      ctx.engine.emit('downloads.changed', ctx.engine.downloads)
      await waitUntil(() => svc(ctx).notices.store.getState().current !== null)
    },
  }),
  shot('16a-space-switcher', {
    description: 'The Space menu.',
    tabs: activate('pitch'),
    setup: async (ctx) => {
      const { presentSpaceMenu } = await import('../features/presenters')
      void presentSpaceMenu(svc(ctx))
      await overlayShown(ctx, 'menu')
    },
  }),
  shot('16a2-create-space', {
    description: 'The create-Space dialog.',
    tabs: activate('pitch'),
    setup: async (ctx) => {
      const { presentCreateSpace } = await import('../features/presenters')
      void presentCreateSpace(svc(ctx))
      await overlayShown(ctx, 'create-space')
    },
  }),
  shot('16b-members-and-invites', {
    description: 'Space home, members and invites, as the owner sees it, with a fresh invite link.',
    tabs: BROWSING,
    route: { name: 'space-home', section: 'members' },
    setup: async (ctx) => {
      await ctx.client.spaces.createInvite('cfo@kotonoha.example')
    },
  }),
  shot('16c-accept-invite', {
    description: 'The accept step after an invite link was opened.',
    tabs: activate('pitch'),
    setup: async (ctx) => {
      ctx.engine.emit('invite.open', { token: 'invite-token-abcdefghij' })
      await overlayShown(ctx, 'invite')
    },
  }),
  shot('16d-activity', {
    description: 'Space home, activity: the audit log and the AI usage.',
    tabs: BROWSING,
    route: { name: 'space-home', section: 'activity' },
  }),
  shareThread,
  shot('17b-share-thread-ready', {
    description: 'The thread sheet with every decision made.',
    tabs: activate('pitch'),
    panelOpen: true,
    edit: (w) => settleAnswer(w, { status: 'complete' }),
    setup: async (ctx) => {
      const { shareThreadActions } = await import('../features/share-thread')
      void shareThreadActions(ctx.client, svc(ctx).overlay).present(ctx.world.ids.privateThread)
      await overlayShown(ctx, 'share-thread')
      await waitUntil(() => ctx.client.shareThread.store.getState().phase === 'deciding')
      ctx.client.shareThread.decide(ctx.world.ids.attachedQuestion, 'exclude')
    },
  }),
  shot('18a-export-menu', {
    description: 'The export menu on an answer.',
    tabs: activate('pitch'),
    panelOpen: true,
    edit: (w) => settleAnswer(w, { status: 'complete' }),
    setup: async (ctx) => {
      const { presentExportMenu } = await import('../features/presenters')
      void presentExportMenu(svc(ctx))
      await overlayShown(ctx, 'menu')
    },
  }),
  shot('18b-google-not-connected', {
    description: 'Exporting to Google before Drive is connected.',
    tabs: activate('pitch'),
    panelOpen: true,
    edit: (w) => settleAnswer(w, { status: 'complete' }),
  }),
  shot('18c-export-done', {
    description: 'The outcome block under the answer, with the document.',
    tabs: activate('pitch'),
    panelOpen: true,
    edit: (w) => settleAnswer(w, { status: 'complete' }),
  }),
  settings,
  shot('20a-sign-in', {
    description: 'Signed out: sign in.',
    tabs: BROWSING,
    signedIn: false,
    route: { name: 'sign-in' },
  }),
  shot('20b-offline-reconnecting', {
    description: 'The server cannot be reached; the client is reconnecting.',
    tabs: activate('pitch'),
    panelOpen: true,
    setup: async (ctx) => {
      ctx.server.setOffline(true)
      await waitUntil(() => ctx.client.ui.getState().connection !== 'online', 5000)
    },
  }),
  shot('20c-page-load-error', {
    description: 'A page that did not load (DNS).',
    tabs: [
      ...BROWSING.map((t) => ({ ...t, active: false })),
      {
        page: 'https://kaigo-hoshu.example/',
        active: true,
        loadError: { code: -105, description: 'ERR_NAME_NOT_RESOLVED' },
      },
    ],
  }),
  shot('20d-tab-crashed', {
    description: 'The page process ended.',
    tabs: BROWSING.map((t) =>
      t.page === 'pitch' ? { ...t, active: true, crashed: true } : { ...t, active: false },
    ),
  }),
  itemDetail,
  shot('22-new-tab', {
    description: 'A new tab.',
    tabs: [...BROWSING.map((t) => ({ ...t, active: false })), { page: '', active: true }],
  }),
  dark('23-dark-17-share-thread-confirm', shareThread),
  dark('23-dark-19-settings', settings),
  dark('23-dark-21-item-detail', itemDetail),
]

export const RIG_SCREENS_ALL: RigScreen[] = [...RIG_SCREENS, ...DESIGN_SCREENS]

export function rigScreen(name: string): RigScreen | null {
  return RIG_SCREENS_ALL.find((s) => s.name === name) ?? null
}
