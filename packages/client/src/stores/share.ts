import { api, type ExtractedPage, type Item, type ShareItemResult } from '@tiger/shared'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { type ApiClientError, toClientError } from '../api'
import { type CaptureOutcome, extractTab, userBlockedHosts } from '../capture'
import { sha256Hex } from '../hash'
import type { ClientContext } from '../load'

/**
 * The share flow as an explicit state machine:
 *
 *   idle ─begin→ extracting ─→ preview ─confirm→ sending ─→ done
 *                    │            │                  └────→ error
 *                    └→ error     └─cancel→ idle (the extraction is discarded)
 *
 * Nothing is sent before `confirm()` is called on a `preview`. The preview holds the exact
 * ExtractedPage that `confirm()` sends; no other object is sent.
 */

export type ShareFailure =
  | { kind: 'capture'; outcome: Extract<CaptureOutcome, { ok: false }> }
  | { kind: 'api'; error: ApiClientError }
  | { kind: 'no-space' }

export type ShareFlowState =
  | { phase: 'idle' }
  | { phase: 'extracting'; tabId: string; spaceId: string }
  | {
      phase: 'preview'
      tabId: string
      spaceId: string
      /** Exactly what `confirm()` sends. */
      page: ExtractedPage
      /** The item this URL already is in the target Space, if any (a re-share makes a version). */
      existing: Item | null
      /** Whether the content differs from `existing`'s current version; null when not shared yet. */
      changed: boolean | null
    }
  | { phase: 'sending'; tabId: string; spaceId: string; page: ExtractedPage }
  | {
      phase: 'done'
      spaceId: string
      outcome: ShareItemResult['outcome']
      item: Item
    }
  | { phase: 'error'; spaceId: string | null; failure: ShareFailure }

export type StaleCheck =
  | { status: 'not-shared' }
  | { status: 'fresh'; item: Item }
  | { status: 'stale'; item: Item; page: ExtractedPage }
  | { status: 'unavailable'; outcome: Extract<CaptureOutcome, { ok: false }> }

export interface ShareFlowController {
  store: StoreApi<ShareFlowState>
  /** Extract the tab locally and show the preview. Does not send anything. */
  begin(tabId: string, spaceId?: string | null): Promise<void>
  /** Send the previewed page. Returns false (and sends nothing) unless the flow is in `preview`. */
  confirm(): Promise<boolean>
  /** Discard the extraction; a running extraction's result is dropped when it arrives. */
  cancel(): void
  /**
   * Is the shared version of this tab's page out of date? Compares a fresh local extraction's
   * content hash with the shared version's hash. Sends nothing.
   */
  checkStale(tabId: string, spaceId?: string | null): Promise<StaleCheck>
}

export interface ShareDeps {
  currentSpaceId(): string | null
  /** The item for this URL in this Space, from the stores (null when not shared there). */
  findItem(url: string, spaceId: string): Item | null | Promise<Item | null>
  /** Called with the server's answer so the stores can update before the socket event arrives. */
  shared(result: ShareItemResult): void
}

export function createShareFlow(ctx: ClientContext, deps: ShareDeps): ShareFlowController {
  const store = createStore<ShareFlowState>()(() => ({ phase: 'idle' }))
  // Each begin/cancel bumps this, so a late extraction or response cannot revive a stale flow.
  let run = 0

  const controller: ShareFlowController = {
    store,

    async begin(tabId, spaceId = deps.currentSpaceId()) {
      const my = ++run
      if (!spaceId) {
        store.setState({ phase: 'error', spaceId: null, failure: { kind: 'no-space' } }, true)
        return
      }
      store.setState({ phase: 'extracting', tabId, spaceId }, true)
      const outcome = await extractTab(ctx.bridge, tabId, await userBlockedHosts(ctx.bridge))
      if (my !== run) return
      if (!outcome.ok) {
        store.setState({ phase: 'error', spaceId, failure: { kind: 'capture', outcome } }, true)
        return
      }
      const existing = await deps.findItem(outcome.page.url, spaceId)
      if (my !== run) return
      const changed = existing
        ? (await sha256Hex(outcome.page.markdown)) !== existing.currentVersion.contentHash
        : null
      if (my !== run) return
      store.setState(
        { phase: 'preview', tabId, spaceId, page: outcome.page, existing, changed },
        true,
      )
    },

    async confirm() {
      const s = store.getState()
      if (s.phase !== 'preview') return false
      const my = ++run
      const { tabId, spaceId, page } = s
      store.setState({ phase: 'sending', tabId, spaceId, page }, true)
      try {
        const result = await ctx.api.call(api.shareItem, { params: { spaceId }, body: { page } })
        deps.shared(result)
        if (my === run)
          store.setState(
            { phase: 'done', spaceId, outcome: result.outcome, item: result.item },
            true,
          )
        return true
      } catch (e) {
        if (my === run)
          store.setState(
            { phase: 'error', spaceId, failure: { kind: 'api', error: toClientError(e) } },
            true,
          )
        return false
      }
    },

    cancel() {
      run++
      store.setState({ phase: 'idle' }, true)
    },

    async checkStale(tabId, spaceId = deps.currentSpaceId()) {
      const outcome = await extractTab(ctx.bridge, tabId, await userBlockedHosts(ctx.bridge))
      if (!outcome.ok) return { status: 'unavailable', outcome }
      const item = spaceId ? await deps.findItem(outcome.page.url, spaceId) : null
      if (!item) return { status: 'not-shared' }
      const hash = await sha256Hex(outcome.page.markdown)
      return hash === item.currentVersion.contentHash
        ? { status: 'fresh', item }
        : { status: 'stale', item, page: outcome.page }
    },
  }
  return controller
}
