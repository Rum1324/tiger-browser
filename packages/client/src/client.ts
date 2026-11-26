import { api, type EngineBridge, type Locale, type ServerEvent } from '@tiger/shared'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { type ApiClient, createApiClient, type FetchLike } from './api'
import { createExport, type ExportController } from './export'
import { type Translator, translator } from './i18n'
import type { ClientContext } from './load'
import { type ConnectionState, RealtimeClient, type WebSocketCtor } from './realtime'
import { type ActivityController, createActivity } from './stores/activity'
import {
  createItems,
  createUrlShare,
  type ItemsController,
  type UrlShareController,
} from './stores/items'
import { createGoogle, type GoogleController } from './stores/google'
import { createModels, type ModelsController } from './stores/models'
import { createSession, type SessionController } from './stores/session'
import { createShareFlow, type ShareFlowController } from './stores/share'
import { createSpaces, type SpacesController } from './stores/spaces'
import { createThreads, type ThreadsController } from './stores/threads'

export interface TigerClientOptions {
  /** The API root, e.g. `https://api.tiger.example` (the engine's `Settings.serverUrl`). */
  serverUrl: string
  /** The engine contract (`window.tiger` in the Electron UI; a fake in tests). */
  bridge: EngineBridge
  fetch?: FetchLike
  WebSocket?: WebSocketCtor
  /** Validate REST responses against the contract (default: on unless NODE_ENV=production). */
  validateResponses?: boolean
  /** Realtime tuning; tests shorten the backoff. */
  realtime?: { baseBackoffMs?: number; maxBackoffMs?: number; heartbeatMs?: number }
  /** How long a gap in a streaming answer may last before it is repaired by a refetch. */
  gapRepairMs?: number
}

export interface UiState {
  connection: ConnectionState
  locale: Locale
}

export interface TigerClient {
  api: ApiClient
  realtime: RealtimeClient
  /** Connection state and locale, for the chrome. */
  ui: StoreApi<UiState>
  t: () => Translator
  session: SessionController
  spaces: SpacesController
  items: ItemsController
  urlShare: UrlShareController
  share: ShareFlowController
  threads: ThreadsController
  models: ModelsController
  activity: ActivityController
  exports: ExportController
  google: GoogleController
  /** Restore the session from the engine's stored token and load everything. */
  start(): Promise<void>
  /** Stop the socket and detach from the engine (window closing). */
  dispose(): void
}

/**
 * Build the client: every store and controller the browser UI needs, below the pixels. The UI
 * subscribes to the stores (`store.subscribe` / `getState`, or `useStore` from `@tiger/client/react`)
 * and calls controller methods; it never talks to the server or the engine itself.
 */
export function createTigerClient(opts: TigerClientOptions): TigerClient {
  const { bridge } = opts
  let session: SessionController | null = null
  const token = () => session?.token() ?? null

  const apiClient = createApiClient({
    serverUrl: opts.serverUrl,
    getToken: token,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.validateResponses !== undefined ? { validate: opts.validateResponses } : {}),
    onUnauthenticated: () => void session?.expire(),
  })
  const realtime = new RealtimeClient({
    serverUrl: opts.serverUrl,
    getToken: token,
    ...(opts.WebSocket ? { WebSocket: opts.WebSocket } : {}),
    ...opts.realtime,
  })
  const ctx: ClientContext = {
    api: apiClient,
    bridge,
    userId: () => session?.store.getState().user?.id ?? null,
  }
  const ui = createStore<UiState>()(() => ({ connection: 'offline', locale: 'ja' }))

  const models = createModels(ctx)
  const activity = createActivity(ctx)
  const urlShare = createUrlShare(ctx)
  const items = createItems(ctx)
  const threads = createThreads(
    ctx,
    {
      modelForMessage: () => models.store.getState().selected,
      messagePosted: () => models.consumeSelection(),
      answerFinished: (spaceId) => {
        if (activity.store.getState().spaceId === spaceId) void activity.refreshUsage()
      },
    },
    opts.gapRepairMs !== undefined ? { gapRepairMs: opts.gapRepairMs } : {},
  )
  const spaces = createSpaces(ctx, {
    listChanged: (ids) => {
      realtime.setSpaces(ids)
      urlShare.membershipChanged(ids)
    },
    currentChanged: (spaceId) => {
      void items.load(spaceId)
      void threads.load(spaceId)
      void activity.load(spaceId)
    },
  })
  const share = createShareFlow(ctx, {
    currentSpaceId: () => spaces.store.getState().currentSpaceId,
    // Matched in the local index: the URL of the page being previewed is not sent anywhere.
    findItem: async (url, spaceId) => {
      await urlShare.whenReady()
      return urlShare.inSpace(url, spaceId)
    },
    shared: (result) => {
      // The socket event follows; applying the answer now avoids a flash of the old state.
      const e: ServerEvent = { type: 'item.upserted', item: result.item }
      items.handleEvent(e)
      urlShare.applyItem(result.item)
    },
  })
  const exports = createExport(ctx)
  const google = createGoogle(ctx)

  session = createSession(ctx, {
    signedIn: (_user, list) => {
      // The index first, so that setList below sees no new Space and does not fetch it twice.
      void urlShare.start(list.map((s) => s.id))
      spaces.setList(list)
      realtime.setSpaces(list.map((s) => s.id))
      realtime.start()
      void models.load()
      void spaces.restoreCurrent()
    },
    signedOut: () => {
      realtime.stop()
      spaces.reset()
      items.reset()
      threads.reset()
      activity.reset()
      models.reset()
      share.cancel()
      // Tab URLs stay known; their share state is cleared because it was the old member's view.
      const tabs = urlShare.store.getState().tabs
      urlShare.reset()
      urlShare.store.setState({ tabs })
    },
  })

  const offs: (() => void)[] = []
  offs.push(
    realtime.on('state', (connection) => ui.setState({ connection })),
    realtime.on('event', (e) => {
      spaces.handleEvent(e)
      items.handleEvent(e)
      urlShare.handleEvent(e)
      threads.handleEvent(e)
      activity.handleEvent(e)
    }),
    realtime.on('resync', () => {
      // Anything could have happened while the socket was down: refetch what the stores show.
      void spaces.refresh()
      void items.reload()
      void urlShare.refresh()
      void threads.resync()
      void activity.reload()
      void spaces.loadDetail()
    }),
    realtime.on('unauthorized', () => {
      // Ask the server; a 401 there expires the session through onUnauthenticated.
      void apiClient.call(api.me, {}).catch(() => {})
    }),
  )

  return {
    api: apiClient,
    realtime,
    ui,
    t: () => translator(ui.getState().locale),
    session,
    spaces,
    items,
    urlShare,
    share,
    threads,
    models,
    activity,
    exports,
    google,
    async start() {
      try {
        const settings = await bridge.invoke('settings.get')
        ui.setState({ locale: settings.locale })
      } catch {
        // Keep the default locale.
      }
      offs.push(
        bridge.on('settings.changed', (s) => ui.setState({ locale: s.locale })),
        bridge.on('invite.open', ({ token }) => spaces.offerInvite(token)),
        urlShare.attachTabs(),
        google.attach(),
      )
      void google.refresh()
      await session?.boot()
    },
    dispose() {
      for (const off of offs.splice(0)) off()
      realtime.stop()
      realtime.events.clear()
    },
  }
}
