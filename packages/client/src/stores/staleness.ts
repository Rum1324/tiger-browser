import { sourceTypeForUrl } from '@tiger/shared'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { StaleCheck } from './share'

/**
 * When the shared version of a tab's page is compared with the page (DESIGN.md 15.2 item 9): when a
 * tab becomes active, when the share or ask surface opens, and when the member asks (「更新を確認」).
 * Never on a timer, and at most once per STALE_CHECK_INTERVAL_MS per tab and page. Google Docs,
 * Sheets and Slides are checked only on the member's request, because the check fetches them from
 * Google. A check extracts the page locally and compares hashes with the local index: nothing is sent
 * to Tiger's server.
 */
export const STALE_CHECK_INTERVAL_MS = 60_000

export type StaleTrigger = 'tab-activated' | 'surface-opened' | 'explicit'

export interface TabStaleness {
  /** The page the result is for; a navigation to another page starts afresh. */
  url: string
  checking: boolean
  /** The last finished check, or null before the first one. */
  result: StaleCheck | null
  /** Epoch ms when the last check finished (「最終確認 n分前」); null before the first one. */
  lastCheckedAt: number | null
}

export interface StalenessState {
  tabs: Record<string, TabStaleness>
}

export interface StalenessController {
  store: StoreApi<StalenessState>
  /**
   * Check this tab if the policy allows it now. Resolves to the check's result, the last result when
   * the policy says not yet (or null when there is none), or null when the tab is unknown, its page
   * is not shared in the current Space, or it is a Google file and the trigger is not `explicit`.
   */
  request(tabId: string, trigger: StaleTrigger): Promise<StaleCheck | null>
  /** The engine's tab list changed: forget closed tabs, check a newly activated one. */
  tabsChanged(tabs: { id: string; url: string }[], activeTabId: string | null): void
  /** Drop what is known about a tab (for example after its page was shared again). */
  forget(tabId: string): void
  reset(): void
}

export interface StalenessDeps {
  /** The tab's current URL, or null when there is no such tab. */
  tabUrl(tabId: string): string | null
  /** Whether this page is shared in the current Space (local index only: sends nothing). */
  isShared(url: string): boolean
  check(tabId: string): Promise<StaleCheck>
  now?(): number
}

const GOOGLE_FILES = new Set(['google-doc', 'google-sheet', 'google-slides'])

export function createStaleness(deps: StalenessDeps): StalenessController {
  const now = deps.now ?? Date.now
  const store = createStore<StalenessState>()(() => ({ tabs: {} }))
  /** Checks in flight, per tab, with the page they are for. */
  const running = new Map<
    string,
    { url: string; ticket: object; done: Promise<StaleCheck | null> }
  >()
  /** When the last check of each tab started, for the interval (a failed check counts too). */
  const started = new Map<string, { url: string; at: number }>()
  let activeTabId: string | null = null
  let generation = 0

  const setTab = (tabId: string, entry: TabStaleness | null) => {
    const { [tabId]: _old, ...rest } = store.getState().tabs
    store.setState({ tabs: entry ? { ...rest, [tabId]: entry } : rest })
  }

  const controller: StalenessController = {
    store,

    async request(tabId, trigger) {
      const url = deps.tabUrl(tabId)
      if (!url) return null
      if (GOOGLE_FILES.has(sourceTypeForUrl(url)) && trigger !== 'explicit') return null
      if (!deps.isShared(url)) return null
      const inFlight = running.get(tabId)
      if (inFlight?.url === url) return inFlight.done
      const known = store.getState().tabs[tabId]
      const last = started.get(tabId)
      if (last?.url === url && now() - last.at < STALE_CHECK_INTERVAL_MS) {
        return known?.url === url ? known.result : null
      }

      const gen = generation
      started.set(tabId, { url, at: now() })
      setTab(tabId, {
        url,
        checking: true,
        result: known?.url === url ? known.result : null,
        lastCheckedAt: known?.url === url ? known.lastCheckedAt : null,
      })
      const ticket = {}
      const done = (async () => {
        let result: StaleCheck | null = null
        try {
          result = await deps.check(tabId)
        } catch {
          result = null
        }
        if (running.get(tabId)?.ticket === ticket) running.delete(tabId)
        // Dropped when the tab navigated, closed or the client was reset meanwhile.
        if (gen !== generation || deps.tabUrl(tabId) !== url) return result
        const prev = store.getState().tabs[tabId]
        setTab(tabId, {
          url,
          checking: false,
          result: result ?? (prev?.url === url ? prev.result : null),
          lastCheckedAt: result ? now() : (prev?.lastCheckedAt ?? null),
        })
        return result
      })()
      running.set(tabId, { url, ticket, done })
      return done
    },

    tabsChanged(tabs, active) {
      const open = new Set(tabs.map((t) => t.id))
      for (const id of Object.keys(store.getState().tabs)) if (!open.has(id)) controller.forget(id)
      for (const id of [...started.keys()]) if (!open.has(id)) started.delete(id)
      const activated = active !== null && active !== activeTabId
      activeTabId = active
      if (activated && active) void controller.request(active, 'tab-activated')
    },

    forget(tabId) {
      started.delete(tabId)
      running.delete(tabId)
      setTab(tabId, null)
    },

    reset() {
      generation++
      started.clear()
      running.clear()
      activeTabId = null
      store.setState({ tabs: {} }, true)
    },
  }
  return controller
}
