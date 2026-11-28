import {
  type SessionStatus,
  type ShareFlowState,
  type ShareLocation,
  type TigerClient,
  tabLookupKey,
  type UrlShare,
} from '@tiger/client'
import {
  type CaptureBlockReason,
  canonicalUrl,
  type ExtractedPage,
  type Item,
  type Space,
  type SpaceHue,
  type Tab,
} from '@tiger/shared'
import { useMemo } from 'react'
import { useServices } from '../app/context'
import type { AppServices } from '../app/services'
import type { EngineState } from '../engine/engine-state'
import type { Notice } from '../i18n'
import { popoverAt } from '../overlay/anchors'
import { attachActions } from './attach'
import { shareActions } from './share'
import { createStore, shallow, useStore, type WritableStore } from '../lib/store'

/** The minimum the UI needs to draw a Space's seal and name. */
export interface SpaceRef {
  id: string
  name: string
  hue: SpaceHue
  memberCount: number
}
export const spaceRef = (s: Space): SpaceRef => ({
  id: s.id,
  name: s.name,
  hue: s.hue,
  memberCount: s.memberCount,
})

/**
 * Who can read the page in a tab: the design's capsule states (DESIGN.md / prototype parts.js:
 * local | fresh | stale | elsewhere | blocked | private | pending, plus "done" right after sharing),
 * and the cases the data layer adds (the index failed to load, signed out, no Space yet).
 * `home` is not a page state: the toolbar shows it for the Space home surface.
 */
export type PageShareKind =
  | { state: 'none' }
  | { state: 'private' }
  | { state: 'blocked'; reason: CaptureBlockReason | null; rule: string | null }
  | { state: 'local'; canShare: boolean; why: 'signed-out' | 'no-space' | null }
  | { state: 'pending' }
  | { state: 'error'; error: Notice }
  | { state: 'fresh'; location: ShareLocation; space: SpaceRef; elsewhere: SpaceRef[] }
  | { state: 'stale'; location: ShareLocation; space: SpaceRef; elsewhere: SpaceRef[] }
  | { state: 'elsewhere'; locations: ShareLocation[]; spaces: SpaceRef[] }
  | { state: 'just-shared'; outcome: 'new' | 'version' | 'unchanged'; item: Item; canUndo: boolean }

export type PageShareState = PageShareKind & {
  tabId: string | null
  /** The page is attached to the next question of the ask panel (one message only). */
  attached: boolean
  /** The share flow is working on this tab. */
  sharing: 'extracting' | 'preview' | 'sending' | null
}

export type StaleStatus = 'checking' | 'fresh' | 'stale' | 'unavailable'

export interface JustShared {
  tabKey: string
  spaceId: string
  outcome: 'new' | 'version' | 'unchanged'
  item: Item
}

export interface PageShareInput {
  tab: Tab | null
  session: SessionStatus
  currentSpace: Space | null
  spaces: readonly Space[]
  urlShare: UrlShare | null
  /** The stale check of this tab's page against the current Space's version, if one ran. */
  stale: StaleStatus | null
  shareFlow: ShareFlowState
  /** Canonical URLs of the pages attached to the next question. */
  attachedKeys: readonly string[]
  justShared: JustShared | null
}

/** The share state of a tab's page. Pure: every state is tested from plain inputs. */
export function pageShareState(i: PageShareInput): PageShareState {
  const tab = i.tab
  const key = tab ? tabLookupKey(tab) : null
  const flow = i.shareFlow
  const sharing = tab && 'tabId' in flow && flow.tabId === tab.id ? flow.phase : null
  const base = {
    tabId: tab?.id ?? null,
    attached: !!key && i.attachedKeys.includes(key),
    sharing,
  }
  const kind = ((): PageShareKind => {
    if (!tab || tab.url === '') return { state: 'none' }
    if (tab.isPrivate) return { state: 'private' }
    if (!tab.capture.allowed) {
      // A browser-internal page (not http/https) is not "blocked content": nothing to show.
      if (tab.capture.reason === 'scheme') return { state: 'none' }
      return { state: 'blocked', reason: tab.capture.reason, rule: tab.capture.rule }
    }
    if (!key) return { state: 'none' }
    if (i.session !== 'signedIn') return { state: 'local', canShare: false, why: 'signed-out' }
    const current = i.currentSpace
    if (!current) return { state: 'local', canShare: false, why: 'no-space' }
    const js = i.justShared
    if (js && js.tabKey === key && js.spaceId === current.id)
      return {
        state: 'just-shared',
        outcome: js.outcome,
        item: js.item,
        canUndo: js.outcome === 'new',
      }
    const u = i.urlShare
    if (!u || u.status === 'pending') return { state: 'pending' }
    if (u.status === 'error')
      return { state: 'error', error: { key: u.error ? `error.${u.error.code}` : 'error.network' } }
    const refOf = (id: string) => {
      const s = i.spaces.find((x) => x.id === id)
      return s ? spaceRef(s) : null
    }
    const here = u.locations.find((l) => l.spaceId === current.id)
    const others = u.locations.filter((l) => l.spaceId !== current.id)
    const otherSpaces = others.map((l) => refOf(l.spaceId)).filter((s): s is SpaceRef => !!s)
    if (here) {
      const space = spaceRef(current)
      return i.stale === 'stale'
        ? { state: 'stale', location: here, space, elsewhere: otherSpaces }
        : { state: 'fresh', location: here, space, elsewhere: otherSpaces }
    }
    if (others.length) return { state: 'elsewhere', locations: others, spaces: otherSpaces }
    return { state: 'local', canShare: true, why: null }
  })()
  return { ...kind, ...base }
}

// ── Model: stale checks and the "just shared" moment ────────────────────────

export interface PageShareModelState {
  /** `${tabId}|${urlKey}|${contentHash}` → result of the local stale check. */
  stale: Record<string, StaleStatus>
  /** A fresh capture that differs from the shared version, kept for "share new version". */
  stalePages: Record<string, ExtractedPage>
  justShared: JustShared | null
}

export interface PageShareModel {
  store: WritableStore<PageShareModelState>
  /** Compare this tab's page with the current Space's version, locally. */
  checkStale(tabId: string): Promise<StaleStatus | null>
  /** Undo a share made moments ago (only a first share; a version cannot be taken back). */
  undo(): Promise<boolean>
  clearJustShared(): void
  dispose(): void
}

export const JUST_SHARED_MS = 8000
const AUTO_CHECK_DELAY_MS = 1500

export function staleKey(tabId: string, urlKey: string, contentHash: string): string {
  return `${tabId}|${urlKey}|${contentHash}`
}

export function createPageShareModel(deps: {
  client: TigerClient
  engine: EngineState
  autoStaleCheck: boolean
}): PageShareModel {
  const { client, engine } = deps
  const store = createStore<PageShareModelState>({ stale: {}, stalePages: {}, justShared: null })
  let justTimer: ReturnType<typeof setTimeout> | null = null
  let autoTimer: ReturnType<typeof setTimeout> | null = null

  const locate = (tabId: string) => {
    const tab = engine.tabs.getState().value?.tabs.find((t) => t.id === tabId) ?? null
    const key = tab ? tabLookupKey(tab) : null
    const spaceId = client.spaces.store.getState().currentSpaceId
    if (!tab || !key || !spaceId) return null
    const loc = client.urlShare.inSpace(tab.url, spaceId)
    return loc ? { tab, key, spaceId, loc } : null
  }

  const model: PageShareModel = {
    store,
    async checkStale(tabId) {
      const where = locate(tabId)
      if (!where) return null
      const k = staleKey(tabId, where.key, where.loc.contentHash)
      store.setState((s) => ({ stale: { ...s.stale, [k]: 'checking' } }))
      const r = await client.share.checkStale(tabId, where.spaceId)
      const status: StaleStatus =
        r.status === 'stale' ? 'stale' : r.status === 'fresh' ? 'fresh' : 'unavailable'
      store.setState((s) => ({
        stale: { ...s.stale, [k]: status },
        stalePages: r.status === 'stale' ? { ...s.stalePages, [k]: r.page } : s.stalePages,
      }))
      return status
    },
    async undo() {
      const js = store.getState().justShared
      if (js?.outcome !== 'new') return false
      model.clearJustShared()
      return client.items.unshare(js.item.id)
    },
    clearJustShared() {
      if (justTimer) clearTimeout(justTimer)
      justTimer = null
      store.setState({ justShared: null })
    },
    dispose() {
      for (const off of offs) off()
      if (justTimer) clearTimeout(justTimer)
      if (autoTimer) clearTimeout(autoTimer)
    },
  }

  const offs: (() => void)[] = [
    client.share.store.subscribe((s, prev) => {
      if (s.phase !== 'done' || prev.phase === 'done') return
      const key = canonicalUrl(s.item.url)
      if (justTimer) clearTimeout(justTimer)
      store.setState({
        justShared: { tabKey: key, spaceId: s.spaceId, outcome: s.outcome, item: s.item },
      })
      justTimer = setTimeout(() => model.clearJustShared(), JUST_SHARED_MS)
    }),
  ]

  if (deps.autoStaleCheck) {
    // When the active tab shows a page shared in the current Space and has finished loading, compare
    // it once per version with a local capture. Nothing is sent: the hash is compared on this machine.
    const schedule = () => {
      if (autoTimer) clearTimeout(autoTimer)
      autoTimer = null
      const tabs = engine.tabs.getState().value
      const active = tabs?.tabs.find((t) => t.id === tabs.activeTabId)
      if (!active || active.isLoading) return
      const where = locate(active.id)
      if (!where) return
      const k = staleKey(active.id, where.key, where.loc.contentHash)
      if (store.getState().stale[k]) return
      autoTimer = setTimeout(() => {
        autoTimer = null
        void model.checkStale(active.id)
      }, AUTO_CHECK_DELAY_MS)
    }
    offs.push(
      engine.tabs.subscribe(schedule),
      client.urlShare.store.subscribe(schedule),
      client.spaces.store.subscribe((s, p) => {
        if (s.currentSpaceId !== p.currentSpaceId) schedule()
      }),
    )
  }
  return model
}

// ── Hook ────────────────────────────────────────────────────────────────────

/** The share state of a tab's page (the active tab when no id is given). */
export function usePageShare(tabId?: string | null): PageShareState {
  const { client, engine, pageShare } = useServices()
  const tab = useStore(engine.tabs, (s) => {
    const t = s.value
    const id = tabId === undefined ? t?.activeTabId : tabId
    return t?.tabs.find((x) => x.id === id) ?? null
  })
  const session = useStore(client.session.store, (s) => s.status)
  const { currentSpaceId, list } = useStore(
    client.spaces.store,
    (s) => ({ currentSpaceId: s.currentSpaceId, list: s.list }),
    shallow,
  )
  const key = tab ? tabLookupKey(tab) : null
  const urlShare = useStore(client.urlShare.store, (s) =>
    key ? (s.byUrl[key] ?? s.missing) : null,
  )
  const shareFlow = useStore(client.share.store, (s) => s)
  const drafts = useStore(client.threads.store, (s) =>
    s.privateThreadId ? (s.drafts[s.privateThreadId] ?? EMPTY) : EMPTY,
  )
  const { stale, justShared } = useStore(
    pageShare.store,
    (s) => ({ stale: s.stale, justShared: s.justShared }),
    shallow,
  )
  return useMemo(() => {
    const currentSpace = list.find((s) => s.id === currentSpaceId) ?? null
    const here =
      key && currentSpaceId ? urlShare?.locations.find((l) => l.spaceId === currentSpaceId) : null
    const staleStatus =
      tab && key && here ? (stale[staleKey(tab.id, key, here.contentHash)] ?? null) : null
    return pageShareState({
      tab,
      session,
      currentSpace,
      spaces: list,
      urlShare,
      stale: staleStatus,
      shareFlow,
      attachedKeys: drafts.map((p) => canonicalUrl(p.url)),
      justShared,
    })
  }, [tab, key, session, currentSpaceId, list, urlShare, shareFlow, drafts, stale, justShared])
}

const EMPTY: ExtractedPage[] = []

// ── Actions behind the capsule ──────────────────────────────────────────────

/**
 * What the capsule, the tab row and the ask panel's 「このページ」 row can do with a tab's page.
 * Every action that could send the page goes through a sheet with the exact preview first.
 */
export interface PageShareActions {
  /** Open the share sheet (local, stale: a new version, elsewhere: share here too). */
  share(): Promise<boolean>
  /** Open the attach sheet for the next question. */
  attach(): Promise<boolean>
  /** Take this page out of the next question's draft. */
  detach(): void
  /** Take back a share made moments ago (first shares only). */
  undo(): Promise<boolean>
  /** The item index failed to load: try again. */
  retry(): Promise<void>
  /** Compare the page with the shared version again, locally (sends nothing). */
  checkStale(): Promise<StaleStatus | null>
  /** The reason a page can never be shared, as a popover under the capsule (05). */
  showBlockedReason(): Promise<void>
}

export function pageShareActions(s: AppServices, tabId: () => string | null): PageShareActions {
  const tab = () => {
    const id = tabId()
    return s.engine.tabs.getState().value?.tabs.find((t) => t.id === id) ?? null
  }
  return {
    share: () => shareActions(s.client, s.overlay, tabId).present(tabId()),
    attach: () => attachActions(s.client, s.overlay, tabId).present(tabId()),
    detach() {
      const t = tab()
      const key = t ? tabLookupKey(t) : null
      const threads = s.client.threads.store.getState()
      const tid = threads.privateThreadId
      if (!key || !tid) return
      const index = (threads.drafts[tid] ?? []).findIndex((p) => canonicalUrl(p.url) === key)
      if (index !== -1) s.client.threads.removeAttachment(tid, index)
    },
    undo: () => s.pageShare.undo(),
    retry: () => s.client.urlShare.refresh(),
    async checkStale() {
      const id = tabId()
      return id ? s.pageShare.checkStale(id) : null
    },
    async showBlockedReason() {
      const t = tab()
      if (!t || t.capture.allowed) return
      await s.overlay.open(
        'blocked-reason',
        { reason: t.capture.reason, rule: t.capture.rule, url: t.url },
        popoverAt('page-state', 'popover'),
      ).outcome
    },
  }
}

/** The capsule's actions for a tab's page (the active tab when no id is given). */
export function usePageShareActions(tabId?: string | null): PageShareActions {
  const services = useServices()
  return useMemo(
    () =>
      pageShareActions(services, () =>
        tabId === undefined ? (services.engine.tabs.getState().value?.activeTabId ?? null) : tabId,
      ),
    [services, tabId],
  )
}
