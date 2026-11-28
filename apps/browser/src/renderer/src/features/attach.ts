import {
  type AttachFlowState,
  attachFailureKey,
  MAX_ATTACHMENTS,
  PROVIDER_COMPANY,
  type TigerClient,
} from '@tiger/client'
import type { ExtractedPage, ModelRef } from '@tiger/shared'
import { useMemo } from 'react'
import { useServices } from '../app/context'
import type { Notice } from '../i18n'
import type { OverlayHost } from '../overlay/host'
import { shallow, useStore } from '../lib/store'

/**
 * Attach the current page to ONE question of the private ask thread, with a preview and the name of
 * the company the page is sent to (the provider of the model that will answer). The page leaves the
 * machine only when that question is posted. Plain data: also the attach sheet's props.
 */
export interface AttachView {
  phase: AttachFlowState['phase']
  /** The page being previewed. */
  page: ExtractedPage | null
  error: Notice | null
  /** Who receives the page: a company name, or null for the local test model. */
  company: string | null
  /** Pages already attached to the next question. */
  drafts: ExtractedPage[]
  max: number
  full: boolean
}

export type AttachSheetEvent = { type: 'confirm' } | { type: 'cancel' }

export interface AttachActions {
  /** Extract the tab (default: active) and show the preview. Creates the private thread if needed. */
  begin(tabId?: string | null): Promise<void>
  confirm(): boolean
  cancel(): void
  remove(index: number): void
  /** Begin and present the attach sheet; resolves true when the page was added to the draft. */
  present(tabId?: string | null): Promise<boolean>
}

export function receivingCompany(selected: ModelRef | null, fallback: ModelRef | null): string | null {
  const ref = selected ?? fallback
  return ref ? PROVIDER_COMPANY[ref.provider] : null
}

function viewFrom(
  a: AttachFlowState,
  drafts: ExtractedPage[],
  selected: ModelRef | null,
  fallback: ModelRef | null,
): AttachView {
  return {
    phase: a.phase,
    page: a.phase === 'preview' ? a.page : null,
    error: a.phase === 'error' ? { key: attachFailureKey(a.failure) } : null,
    company: receivingCompany(selected, fallback),
    drafts,
    max: MAX_ATTACHMENTS,
    full: drafts.length >= MAX_ATTACHMENTS,
  }
}

const NO_DRAFTS: ExtractedPage[] = []

export function attachView(client: TigerClient): AttachView {
  const t = client.threads.store.getState()
  const m = client.models.store.getState()
  const drafts = t.privateThreadId ? (t.drafts[t.privateThreadId] ?? NO_DRAFTS) : NO_DRAFTS
  return viewFrom(t.attach, drafts, m.selected, m.memberDefault ?? m.serverDefault)
}

export function useAttach(): AttachView & AttachActions {
  const services = useServices()
  const { client } = services
  const t = useStore(
    client.threads.store,
    (s) => ({
      attach: s.attach,
      drafts: s.privateThreadId ? (s.drafts[s.privateThreadId] ?? NO_DRAFTS) : NO_DRAFTS,
    }),
    shallow,
  )
  const m = useStore(
    client.models.store,
    (s) => ({ selected: s.selected, fallback: s.memberDefault ?? s.serverDefault }),
    shallow,
  )
  return useMemo(
    () => ({
      ...viewFrom(t.attach, t.drafts, m.selected, m.fallback),
      ...attachActions(client, services.overlay, () => services.engine.tabs.getState().value?.activeTabId ?? null),
    }),
    [t, m, client, services],
  )
}

export function attachActions(
  client: TigerClient,
  overlay: OverlayHost,
  activeTabId: () => string | null,
): AttachActions {
  const begin = async (tabId?: string | null) => {
    const id = tabId ?? activeTabId()
    if (!id) return
    const thread = await client.threads.ensurePrivateThread()
    if (!thread) return
    await client.threads.beginAttach(thread.id, id)
  }
  const removeAt = (index: number) => {
    const tid = client.threads.store.getState().privateThreadId
    if (tid) client.threads.removeAttachment(tid, index)
  }
  return {
    begin,
    confirm: () => client.threads.confirmAttach(),
    cancel: () => client.threads.cancelAttach(),
    remove: removeAt,
    async present(tabId) {
      const started = begin(tabId)
      let attached = false
      const handle = overlay.open('attach', attachView(client), { mode: 'modal' }, {
        onEvent(e) {
          if (e.type === 'confirm') {
            attached = client.threads.confirmAttach()
            if (attached) handle.close('closed')
          }
          if (e.type === 'cancel') handle.close('closed')
        },
      })
      const offs = [
        client.threads.store.subscribe(() => handle.update(attachView(client))),
        client.models.store.subscribe(() => handle.update(attachView(client))),
      ]
      await started
      await handle.outcome
      for (const off of offs) off()
      if (!attached && client.threads.store.getState().attach.phase !== 'idle') client.threads.cancelAttach()
      return attached
    },
  }
}
