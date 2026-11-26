import {
  api,
  canonicalUrl,
  type Item,
  type ItemDetail,
  type ItemVersionRef,
  type ServerEvent,
  type Tab,
  type TabsState,
} from '@tiger/shared'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { type ApiClientError, toClientError } from '../api'
import { type ClientContext, failed, IDLE, LOADING, type Load, READY } from '../load'

// ── Items of the current Space ──────────────────────────────────────────────

export interface ItemsState {
  spaceId: string | null
  /** Newest change first. */
  items: Item[]
  load: Load
  mutation: Load
}

export interface ItemsController {
  store: StoreApi<ItemsState>
  load(spaceId: string | null): Promise<void>
  reload(): Promise<void>
  /** Deletes the content, versions and embeddings on the server; both clients update by event. */
  unshare(itemId: string): Promise<boolean>
  detail(itemId: string): Promise<ItemDetail>
  versions(itemId: string): Promise<ItemVersionRef[]>
  byUrl(url: string): Item | null
  handleEvent(e: ServerEvent): void
  reset(): void
}

const byNewest = (a: Item, b: Item) => (a.updatedAt < b.updatedAt ? 1 : -1)

export function createItems(
  ctx: ClientContext,
  hooks: { loaded(spaceId: string, items: Item[]): void },
): ItemsController {
  const initial = (): ItemsState => ({ spaceId: null, items: [], load: IDLE, mutation: IDLE })
  const store = createStore<ItemsState>()(initial)

  const controller: ItemsController = {
    store,
    async load(spaceId) {
      store.setState({ spaceId, items: [], load: spaceId ? LOADING : IDLE })
      if (!spaceId) return
      try {
        const items = await ctx.api.call(api.listItems, { params: { spaceId } })
        if (store.getState().spaceId !== spaceId) return
        store.setState({ items: [...items].sort(byNewest), load: READY })
        hooks.loaded(spaceId, items)
      } catch (e) {
        if (store.getState().spaceId === spaceId) store.setState({ load: failed(toClientError(e)) })
      }
    },
    reload() {
      return controller.load(store.getState().spaceId)
    },
    async unshare(itemId) {
      store.setState({ mutation: LOADING })
      try {
        await ctx.api.call(api.unshareItem, { params: { itemId } })
        store.setState({
          items: store.getState().items.filter((i) => i.id !== itemId),
          mutation: READY,
        })
        return true
      } catch (e) {
        store.setState({ mutation: failed(toClientError(e)) })
        return false
      }
    },
    detail: (itemId) => ctx.api.call(api.getItem, { params: { itemId } }),
    versions: (itemId) => ctx.api.call(api.listItemVersions, { params: { itemId } }),
    byUrl(url) {
      const key = canonicalUrl(url)
      return store.getState().items.find((i) => canonicalUrl(i.url) === key) ?? null
    },
    handleEvent(e) {
      const { spaceId, items } = store.getState()
      if (e.type === 'item.upserted' && e.item.spaceId === spaceId) {
        const rest = items.filter((i) => i.id !== e.item.id)
        store.setState({ items: [e.item, ...rest].sort(byNewest) })
      } else if (e.type === 'item.deleted' && e.spaceId === spaceId) {
        store.setState({ items: items.filter((i) => i.id !== e.itemId) })
      }
    },
    reset() {
      store.setState(initial(), true)
    },
  }
  return controller
}

// ── Share state per URL (for tabs) ──────────────────────────────────────────

/** One Space that holds this URL. */
export interface ShareLocation {
  spaceId: string
  itemId: string
  sharedById: string
  updatedAt: string
  /**
   * The full item when known: who shared it (`sharedBy.name`), which version
   * (`currentVersion.number`, `contentHash`). Null only while that Space's list is loading.
   */
  item: Item | null
}

/**
 * `pending`: queued or in flight. `ready`: `locations` is authoritative (empty = not shared).
 * `error`: the lookup failed; `refreshAll()` retries.
 */
export interface UrlShare {
  status: 'pending' | 'ready' | 'error'
  locations: ShareLocation[]
  error: ApiClientError | null
}

/** What the UI shows for a tab whose page may never be captured: no lookup is made for it. */
export const NOT_ELIGIBLE: UrlShare = Object.freeze({
  status: 'ready',
  locations: [],
  error: null,
}) as UrlShare

export interface UrlShareState {
  /** Keyed by canonicalUrl. */
  byUrl: Record<string, UrlShare>
  /** tabId → canonical URL, or null when the tab's page is not eligible for capture. */
  tabs: Record<string, string | null>
}

export interface UrlShareController {
  store: StoreApi<UrlShareState>
  /** Queue URLs for lookup; resolves when they are resolved. Already known URLs cost nothing. */
  track(urls: readonly string[]): Promise<void>
  forUrl(url: string): UrlShare | null
  forTab(tabId: string): UrlShare | null
  /** Is this URL shared in this Space, and as which item? */
  inSpace(url: string, spaceId: string): ShareLocation | null
  /** Follow the engine's tabs: a tab that navigates gets the state of its new URL. */
  syncTabs(state: TabsState): Promise<void>
  /** Start following `tabs.changed` from the bridge. Returns the unsubscribe. */
  attachTabs(): () => void
  /** Look every tracked URL up again (after a reconnect). */
  refreshAll(): Promise<void>
  primeSpace(spaceId: string, items: Item[]): void
  handleEvent(e: ServerEvent): void
  reset(): void
}

const MAX_LOOKUP = 100

/** Lookups send the URL to the server, so only pages that could be shared are ever looked up. */
export function tabLookupKey(tab: Tab): string | null {
  if (tab.isPrivate || !tab.capture.allowed) return null
  if (!/^https?:\/\//i.test(tab.url)) return null
  return canonicalUrl(tab.url)
}

export function createUrlShare(
  ctx: ClientContext,
  opts: { batchDelayMs?: number } = {},
): UrlShareController {
  const initial = (): UrlShareState => ({ byUrl: {}, tabs: {} })
  const store = createStore<UrlShareState>()(initial)
  const batchDelayMs = opts.batchDelayMs ?? 15
  const itemsById = new Map<string, Item>()
  const loadedSpaces = new Map<string, Promise<void>>()
  let queue = new Set<string>()
  let flushPromise: Promise<void> | null = null
  const inflight = new Set<Promise<void>>()
  let epoch = 0

  const setUrl = (key: string, value: UrlShare) =>
    store.setState({ byUrl: { ...store.getState().byUrl, [key]: value } })

  const sortLocations = (l: ShareLocation[]) =>
    [...l].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))

  function ensureSpace(spaceId: string): Promise<void> {
    let p = loadedSpaces.get(spaceId)
    if (!p) {
      p = ctx.api
        .call(api.listItems, { params: { spaceId } })
        .then((items) => {
          for (const i of items) itemsById.set(i.id, i)
        })
        .catch(() => {
          // Leave the details empty; the next refresh tries again.
          loadedSpaces.delete(spaceId)
        })
      loadedSpaces.set(spaceId, p)
    }
    return p
  }

  async function resolveBatch(keys: string[], at: number): Promise<void> {
    try {
      const rows = await ctx.api.call(api.lookupItemsByUrl, { body: { urls: keys } })
      const spaces = new Set(rows.filter((r) => !itemsById.has(r.itemId)).map((r) => r.spaceId))
      await Promise.all([...spaces].map(ensureSpace))
      if (at !== epoch) return
      const next = { ...store.getState().byUrl }
      for (const key of keys) {
        const locations = rows
          .filter((r) => r.url === key)
          .map((r) => ({
            spaceId: r.spaceId,
            itemId: r.itemId,
            sharedById: r.sharedBy,
            updatedAt: r.updatedAt,
            item: itemsById.get(r.itemId) ?? null,
          }))
        next[key] = { status: 'ready', locations: sortLocations(locations), error: null }
      }
      store.setState({ byUrl: next })
    } catch (e) {
      if (at !== epoch) return
      const error = toClientError(e)
      const next = { ...store.getState().byUrl }
      for (const key of keys) next[key] = { status: 'error', locations: [], error }
      store.setState({ byUrl: next })
    }
  }

  function scheduleFlush(): Promise<void> {
    if (flushPromise) return flushPromise
    const at = epoch
    flushPromise = new Promise<void>((resolve) => setTimeout(resolve, batchDelayMs)).then(
      async () => {
        const keys = [...queue]
        queue = new Set()
        flushPromise = null
        const batches: string[][] = []
        for (let i = 0; i < keys.length; i += MAX_LOOKUP)
          batches.push(keys.slice(i, i + MAX_LOOKUP))
        await Promise.all(batches.map((b) => resolveBatch(b, at)))
      },
    )
    const p = flushPromise
    inflight.add(p)
    void p.finally(() => inflight.delete(p))
    return p
  }

  const settled = () => Promise.all([...inflight]).then(() => undefined)

  const controller: UrlShareController = {
    store,
    track(urls) {
      const byUrl = store.getState().byUrl
      const fresh: string[] = []
      for (const url of urls) {
        if (!/^https?:\/\//i.test(url)) continue
        const key = canonicalUrl(url)
        if (byUrl[key] && byUrl[key].status !== 'error') continue
        if (queue.has(key)) continue
        fresh.push(key)
      }
      if (fresh.length === 0) return settled()
      const next = { ...byUrl }
      for (const key of fresh) {
        queue.add(key)
        next[key] = { status: 'pending', locations: [], error: null }
      }
      store.setState({ byUrl: next })
      return scheduleFlush()
    },
    forUrl(url) {
      return store.getState().byUrl[canonicalUrl(url)] ?? null
    },
    forTab(tabId) {
      const { tabs, byUrl } = store.getState()
      if (!(tabId in tabs)) return null
      const key = tabs[tabId]
      if (key === null || key === undefined) return NOT_ELIGIBLE
      return byUrl[key] ?? null
    },
    inSpace(url, spaceId) {
      return controller.forUrl(url)?.locations.find((l) => l.spaceId === spaceId) ?? null
    },
    syncTabs(state) {
      const tabs: Record<string, string | null> = {}
      for (const tab of state.tabs) tabs[tab.id] = tabLookupKey(tab)
      store.setState({ tabs })
      return controller.track(Object.values(tabs).filter((k): k is string => k !== null))
    },
    attachTabs() {
      const off = ctx.bridge.on('tabs.changed', (s) => void controller.syncTabs(s))
      void ctx.bridge
        .invoke('tabs.get')
        .then((s) => controller.syncTabs(s))
        .catch(() => {})
      return off
    },
    async refreshAll() {
      epoch++
      flushPromise = null
      queue = new Set()
      itemsById.clear()
      loadedSpaces.clear()
      const keys = Object.keys(store.getState().byUrl)
      const next: Record<string, UrlShare> = {}
      for (const k of keys) {
        const prev = store.getState().byUrl[k]
        // Keep showing what was known while the refresh runs.
        next[k] = { status: 'pending', locations: prev?.locations ?? [], error: null }
        queue.add(k)
      }
      store.setState({ byUrl: next })
      if (keys.length) await scheduleFlush()
    },
    primeSpace(spaceId, items) {
      for (const i of items) itemsById.set(i.id, i)
      loadedSpaces.set(spaceId, Promise.resolve())
    },
    handleEvent(e) {
      if (e.type === 'item.upserted') {
        const item = e.item
        itemsById.set(item.id, item)
        const key = canonicalUrl(item.url)
        const cur = store.getState().byUrl[key]
        if (!cur) return
        const loc: ShareLocation = {
          spaceId: item.spaceId,
          itemId: item.id,
          sharedById: item.sharedBy.id,
          updatedAt: item.updatedAt,
          item,
        }
        const rest = cur.locations.filter((l) => l.itemId !== item.id)
        setUrl(key, { ...cur, locations: sortLocations([loc, ...rest]) })
      } else if (e.type === 'item.deleted') {
        itemsById.delete(e.itemId)
        const key = canonicalUrl(e.url)
        const cur = store.getState().byUrl[key]
        if (!cur) return
        setUrl(key, { ...cur, locations: cur.locations.filter((l) => l.itemId !== e.itemId) })
      } else if (e.type === 'member.removed' && e.userId === ctx.userId()) {
        // Locations in a Space this member left are no longer visible to them.
        const next: Record<string, UrlShare> = {}
        for (const [k, v] of Object.entries(store.getState().byUrl)) {
          next[k] = { ...v, locations: v.locations.filter((l) => l.spaceId !== e.spaceId) }
        }
        store.setState({ byUrl: next })
      }
    },
    reset() {
      epoch++
      queue = new Set()
      flushPromise = null
      itemsById.clear()
      loadedSpaces.clear()
      store.setState(initial(), true)
    },
  }
  return controller
}
