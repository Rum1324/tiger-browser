import {
  type ShareFlowState,
  type ShareLocation,
  shareFailureKey,
  type TigerClient,
} from '@tiger/client'
import type { ExtractedPage, Item } from '@tiger/shared'
import { useMemo } from 'react'
import { useServices } from '../app/context'
import type { Notice } from '../i18n'
import { useStore } from '../lib/store'
import type { OverlayHost } from '../overlay/host'
import { type SpaceRef, spaceRef } from './page-share'

/**
 * Share with preview, as plain data (it is also the share sheet's props in the overlay view).
 * Nothing leaves the machine before `confirm()`: the preview is exactly what is sent.
 */
export type ShareView =
  | { phase: 'idle' }
  | { phase: 'extracting'; space: SpaceRef | null }
  | {
      phase: 'preview'
      space: SpaceRef | null
      page: ExtractedPage
      existing: ShareLocation | null
      /** Null when not shared there yet; false = same content as the shared version. */
      changed: boolean | null
    }
  | { phase: 'sending'; space: SpaceRef | null; page: ExtractedPage }
  | { phase: 'done'; space: SpaceRef | null; outcome: 'new' | 'version' | 'unchanged'; item: Item }
  | { phase: 'error'; space: SpaceRef | null; error: Notice }

export function shareView(
  s: ShareFlowState,
  spaces: readonly import('@tiger/shared').Space[],
): ShareView {
  const ref = (id: string | null) => {
    const sp = id ? spaces.find((x) => x.id === id) : undefined
    return sp ? spaceRef(sp) : null
  }
  switch (s.phase) {
    case 'idle':
      return { phase: 'idle' }
    case 'extracting':
      return { phase: 'extracting', space: ref(s.spaceId) }
    case 'preview':
      return {
        phase: 'preview',
        space: ref(s.spaceId),
        page: s.page,
        existing: s.existing,
        changed: s.changed,
      }
    case 'sending':
      return { phase: 'sending', space: ref(s.spaceId), page: s.page }
    case 'done':
      return { phase: 'done', space: ref(s.spaceId), outcome: s.outcome, item: s.item }
    case 'error':
      return { phase: 'error', space: ref(s.spaceId), error: { key: shareFailureKey(s.failure) } }
  }
}

/** What the share sheet sends back while it stays open. */
export type ShareSheetEvent = { type: 'confirm' } | { type: 'cancel' }

export interface ShareActions {
  /** Extract the tab locally and show the preview (sends nothing). Defaults: active tab, current Space. */
  begin(tabId?: string | null, spaceId?: string | null): Promise<void>
  /** The only call that sends the page. */
  confirm(): Promise<boolean>
  cancel(): void
  /** Begin and present the share sheet; resolves when the sheet closes, true if it was shared. */
  present(tabId?: string | null, spaceId?: string | null): Promise<boolean>
}

export function useShare(): ShareView & ShareActions {
  const services = useServices()
  const { client } = services
  const flow = useStore(client.share.store, (s) => s)
  const spaces = useStore(client.spaces.store, (s) => s.list)
  return useMemo(() => {
    const actions = shareActions(
      services.client,
      services.overlay,
      () => services.engine.tabs.getState().value?.activeTabId ?? null,
    )
    return { ...shareView(flow, spaces), ...actions }
  }, [flow, spaces, services])
}

export function shareActions(
  client: TigerClient,
  overlay: OverlayHost,
  activeTabId: () => string | null,
): ShareActions {
  const begin = async (tabId?: string | null, spaceId?: string | null) => {
    const id = tabId ?? activeTabId()
    if (!id) return
    await client.share.begin(id, spaceId ?? client.spaces.store.getState().currentSpaceId)
  }
  return {
    begin,
    confirm: () => client.share.confirm(),
    cancel: () => client.share.cancel(),
    async present(tabId, spaceId) {
      const view = () =>
        shareView(client.share.store.getState(), client.spaces.store.getState().list)
      const started = begin(tabId, spaceId)
      const handle = overlay.open(
        'share',
        view(),
        { mode: 'modal' },
        {
          onEvent(e) {
            if (e.type === 'confirm') void client.share.confirm()
            if (e.type === 'cancel') handle.close('closed')
          },
        },
      )
      const off = client.share.store.subscribe(() => {
        const v = view()
        handle.update(v)
        // A share that finished closes the sheet; the toolbar takes over (just shared + undo).
        if (v.phase === 'done') handle.close('closed')
      })
      await started
      const outcome = await handle.outcome
      off()
      const end = client.share.store.getState()
      if (end.phase !== 'done' && end.phase !== 'sending') client.share.cancel()
      return end.phase === 'done' || outcome.status === 'result'
    },
  }
}
