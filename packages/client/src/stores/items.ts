import {
  api,
  canonicalUrl,
  type Item,
  type ItemDetail,
  type ItemIndexEntry,
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

export function createItems(ctx: ClientContext): ItemsController {
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

// ── Share state per URL (for tabs), from the member's local item index ────────

/** One Space that holds this URL: who shared it, at which version (the index row itself). */
export type ShareLocation = ItemIndexEntry

/**
 * `pending`: the index has not loaded yet. `ready`: `locations` is authoritative (empty = not shared).
 * `error`: the index could not be loaded; `refresh()` retries.
 */
export interface UrlShare {
  status: 'pending' | 'ready' | 'error'
  /** Newest change first. */
  locations: ShareLocation[]
  error: ApiClientError | null
}

const frozen = (u: UrlShare): UrlShare => Object.freeze(u) as UrlShare

/** What the UI shows for a tab whose page may never be captured. */
export const NOT_ELIGIBLE: UrlShare = frozen({ status: 'ready', locations: [], error: null })
const NOT_SHARED: UrlShare = frozen({ status: 'ready', locations: [], error: null })
const PENDING: UrlShare = frozen({ status: 'pending', locations: [], error: null })

export interface UrlShareState {
  /** Every item in every Space the member belongs to, by item id. */
  entries: Record<string, ItemIndexEntry>
  /** canonicalUrl → its locations. Derived from `entries`; values are stable between changes. */
  byUrl: Record<string, UrlShare>
  /** What a URL that is not in `byUrl` resolves to (pending, not shared, or the load error). */
  missing: UrlShare
  load: Load
  /** tabId → canonical URL, or null when the tab's page is not eligible for capture. */
  tabs: Record<string, string | null>
}

export interface UrlShareController {
  store: StoreApi<UrlShareState>
  /**
   * Fetch the whole index again (`GET /v1/items/index`). The request carries no URL: open tabs are
   * matched against the index on this machine only.
   */
  refresh(): Promise<void>
  /** Resolves once the index has loaded (or failed) at least once since the last reset. */
  whenReady(): Promise<void>
  /** Signed in: remember the member's Spaces and load the index. */
  start(spaceIds: readonly string[]): Promise<void>
  /** The member's Spaces changed: a new Space means refetching, a lost one drops its rows. */
  membershipChanged(spaceIds: readonly string[]): void
  forUrl(url: string): UrlShare
  forTab(tabId: string): UrlShare | null
  /** Is this URL shared in this Space, and as which item? */
  inSpace(url: string, spaceId: string): ShareLocation | null
  /** Follow the engine's tabs: a tab that navigates gets the state of its new URL. Local only. */
  syncTabs(state: TabsState): void
  /** Start following `tabs.changed` from the bridge. Returns the unsubscribe. */
  attachTabs(): () => void
  /** Apply a share result before its socket event arrives. */
  applyItem(item: Item): void
  handleEvent(e: ServerEvent): void
  reset(): void
}

/**
 * The key a tab is matched under, or null for a page that may never be shared (private window,
 * blocked by the capture rules, not http(s)): such a tab always shows as not shared.
 */
export function tabLookupKey(tab: Tab): string | null {
  if (tab.isPrivate || !tab.capture.allowed) return null
  if (!/^https?:\/\//i.test(tab.url)) return null
  return canonicalUrl(tab.url)
}

export function indexEntryOf(item: Item): ItemIndexEntry {
  return {
    itemId: item.id,
    spaceId: item.spaceId,
    urlKey: canonicalUrl(item.url),
    title: item.title,
    sharedBy: item.sharedBy,
    versionNumber: item.currentVersion.number,
    contentHash: item.currentVersion.contentHash,
    updatedAt: item.updatedAt,
  }
}

type IndexEvent =
  | { kind: 'upsert'; entry: ItemIndexEntry }
  | { kind: 'delete'; itemId: string }
  | { kind: 'leave'; spaceId: string }

const newestFirst = (a: ItemIndexEntry, b: ItemIndexEntry) =>
  a.updatedAt === b.updatedAt ? (a.itemId < b.itemId ? 1 : -1) : a.updatedAt < b.updatedAt ? 1 : -1

export function createUrlShare(ctx: ClientContext): UrlShareController {
  const initial = (): UrlShareState => ({
    entries: {},
    byUrl: {},
    missing: PENDING,
    load: IDLE,
    tabs: {},
  })
  const store = createStore<UrlShareState>()(initial)
  let epoch = 0
  let fetching: Promise<void> | null = null
  let ready: { promise: Promise<void>; resolve: () => void } = deferred()
  let knownSpaces = new Set<string>()
  /** Events seen while a fetch is in flight, replayed over its result so none is lost. */
  let log: IndexEvent[] | null = null

  function deferred() {
    let resolve: () => void = () => {}
    const promise = new Promise<void>((r) => (resolve = r))
    return { promise, resolve }
  }

  function derive(entries: Record<string, ItemIndexEntry>): Record<string, UrlShare> {
    const prev = store.getState().byUrl
    const groups = new Map<string, ItemIndexEntry[]>()
    for (const e of Object.values(entries)) {
      const g = groups.get(e.urlKey)
      if (g) g.push(e)
      else groups.set(e.urlKey, [e])
    }
    const byUrl: Record<string, UrlShare> = {}
    for (const [key, list] of groups) {
      list.sort(newestFirst)
      const old = prev[key]
      // Keep the previous object when nothing changed, so UI selectors stay referentially stable.
      byUrl[key] =
        old &&
        old.status === 'ready' &&
        old.locations.length === list.length &&
        old.locations.every((l, i) => l === list[i])
          ? old
          : frozen({ status: 'ready', locations: list, error: null })
    }
    return byUrl
  }

  function apply(entries: Record<string, ItemIndexEntry>, ev: IndexEvent): void {
    if (ev.kind === 'upsert') {
      const cur = entries[ev.entry.itemId]
      if (!cur || cur.updatedAt <= ev.entry.updatedAt) entries[ev.entry.itemId] = ev.entry
    } else if (ev.kind === 'delete') {
      delete entries[ev.itemId]
    } else {
      for (const [id, e] of Object.entries(entries)) if (e.spaceId === ev.spaceId) delete entries[id]
    }
  }

  function commit(entries: Record<string, ItemIndexEntry>): void {
    store.setState({ entries, byUrl: derive(entries) })
  }

  function record(ev: IndexEvent): void {
    log?.push(ev)
    const entries = { ...store.getState().entries }
    apply(entries, ev)
    commit(entries)
  }

  const controller: UrlShareController = {
    store,

    refresh() {
      const at = ++epoch
      if (!log) log = []
      const s = store.getState()
      store.setState({ load: LOADING, missing: s.load.status === 'ready' ? s.missing : PENDING })
      const run = (async () => {
        try {
          const rows = await ctx.api.call(api.listItemIndex, {})
          if (at !== epoch) return
          const entries: Record<string, ItemIndexEntry> = {}
          for (const r of rows) entries[r.itemId] = r
          for (const ev of log ?? []) apply(entries, ev)
          log = null
          store.setState({ load: READY, missing: NOT_SHARED })
          commit(entries)
        } catch (e) {
          if (at !== epoch) return
          log = null
          const error = toClientError(e)
          store.setState({ load: failed(error), missing: frozen({ status: 'error', locations: [], error }) })
        } finally {
          if (at === epoch) {
            fetching = null
            ready.resolve()
          }
        }
      })()
      fetching = run
      return run
    },

    whenReady() {
      return fetching ?? ready.promise
    },

    start(spaceIds) {
      knownSpaces = new Set(spaceIds)
      return controller.refresh()
    },

    membershipChanged(spaceIds) {
      const next = new Set(spaceIds)
      const added = [...next].some((id) => !knownSpaces.has(id))
      const lost = [...knownSpaces].filter((id) => !next.has(id))
      knownSpaces = next
      for (const spaceId of lost) record({ kind: 'leave', spaceId })
      if (added && store.getState().load.status !== 'idle') void controller.refresh()
    },

    forUrl(url) {
      if (!/^https?:\/\//i.test(url)) return NOT_ELIGIBLE
      const s = store.getState()
      return s.byUrl[canonicalUrl(url)] ?? s.missing
    },

    forTab(tabId) {
      const s = store.getState()
      if (!(tabId in s.tabs)) return null
      const key = s.tabs[tabId]
      if (key === null || key === undefined) return NOT_ELIGIBLE
      return s.byUrl[key] ?? s.missing
    },

    inSpace(url, spaceId) {
      return controller.forUrl(url).locations.find((l) => l.spaceId === spaceId) ?? null
    },

    syncTabs(state) {
      const tabs: Record<string, string | null> = {}
      for (const tab of state.tabs) tabs[tab.id] = tabLookupKey(tab)
      const cur = store.getState().tabs
      const same =
        Object.keys(cur).length === Object.keys(tabs).length &&
        Object.entries(tabs).every(([k, v]) => k in cur && cur[k] === v)
      if (!same) store.setState({ tabs })
    },

    attachTabs() {
      const off = ctx.bridge.on('tabs.changed', (s) => controller.syncTabs(s))
      void ctx.bridge
        .invoke('tabs.get')
        .then((s) => controller.syncTabs(s))
        .catch(() => {})
      return off
    },

    applyItem(item) {
      record({ kind: 'upsert', entry: indexEntryOf(item) })
    },

    handleEvent(e) {
      if (e.type === 'item.upserted') {
        record({ kind: 'upsert', entry: indexEntryOf(e.item) })
      } else if (e.type === 'item.deleted') {
        record({ kind: 'delete', itemId: e.itemId })
      } else if (e.type === 'member.removed' && e.userId === ctx.userId()) {
        // Rows of a Space this member left are no longer theirs to see.
        knownSpaces.delete(e.spaceId)
        record({ kind: 'leave', spaceId: e.spaceId })
      }
    },

    reset() {
      epoch++
      fetching = null
      log = null
      knownSpaces = new Set()
      ready.resolve()
      ready = deferred()
      store.setState(initial(), true)
    },
  }
  return controller
}
