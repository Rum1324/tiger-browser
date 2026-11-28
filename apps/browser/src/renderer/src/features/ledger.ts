import { errorKey } from '@tiger/client'
import type { Item, ItemDetail, ItemVersionRef } from '@tiger/shared'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useServices } from '../app/context'
import type { Notice } from '../i18n'
import { shallow, useStore } from '../lib/store'

export interface LedgerView {
  spaceId: string | null
  /** Newest change first. */
  items: Item[]
  loading: boolean
  error: Notice | null
  /** An unshare in flight, and its failure. */
  busy: boolean
  mutationError: Notice | null
  /** The member may unshare their own items; an owner may unshare any. */
  canUnshare(item: Item): boolean
  /** Deletes the content, every version and its embeddings; only an audit tombstone remains. */
  unshare(itemId: string): Promise<boolean>
  /** Ask first (a confirm sheet in the overlay), then unshare. */
  confirmUnshare(item: Item): Promise<boolean>
  reload(): Promise<void>
  open(item: Item): void
}

const byUpdated = (a: Item, b: Item) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)

export function useLedger(): LedgerView {
  const services = useServices()
  const { client, router } = services
  const s = useStore(client.items.store, (x) => x, shallow)
  const meId = useStore(client.session.store, (x) => x.user?.id ?? null)
  const role = useStore(client.spaces.store, (x) => x.list.find((sp) => sp.id === x.currentSpaceId)?.myRole ?? null)
  return useMemo(() => {
    const canUnshare = (item: Item) => role === 'owner' || item.sharedBy.id === meId
    return {
      spaceId: s.spaceId,
      items: [...s.items].sort(byUpdated),
      loading: s.load.status === 'loading',
      error: s.load.status === 'error' && s.load.error ? { key: errorKey(s.load.error) } : null,
      busy: s.mutation.status === 'loading',
      mutationError:
        s.mutation.status === 'error' && s.mutation.error ? { key: errorKey(s.mutation.error) } : null,
      canUnshare,
      unshare: (id) => client.items.unshare(id),
      async confirmUnshare(item) {
        const handle = services.overlay.open(
          'confirm',
          {
            title: { key: 'ledger.unshareTitle' },
            body: { key: 'ledger.unshareBody' },
            subject: item.title,
            confirm: { key: 'ledger.unshareConfirm' },
            destructive: true,
          },
          { mode: 'modal' },
        )
        const outcome = await handle.outcome
        if (outcome.status !== 'result') return false
        return client.items.unshare(item.id)
      },
      reload: () => client.items.reload(),
      open: (item) => router.go({ name: 'item', itemId: item.id }),
    }
  }, [s, role, meId, client, router, services.overlay])
}

export interface ItemDetailView {
  detail: ItemDetail | null
  versions: ItemVersionRef[]
  loading: boolean
  error: Notice | null
  /** The item is gone (unshared while open). */
  gone: boolean
  reload(): void
}

/** One shared item with its Markdown and version history (loaded when the id changes). */
export function useItemDetail(itemId: string | null): ItemDetailView {
  const { client } = useServices()
  const [state, setState] = useState<{
    id: string | null
    detail: ItemDetail | null
    versions: ItemVersionRef[]
    loading: boolean
    error: Notice | null
  }>({ id: null, detail: null, versions: [], loading: false, error: null })
  const [nonce, setNonce] = useState(0)
  const stillShared = useStore(client.items.store, (x) =>
    itemId ? x.spaceId === null || x.items.some((i) => i.id === itemId) : true,
  )

  useEffect(() => {
    if (!itemId) return
    let live = true
    setState((p) => ({ ...p, id: itemId, loading: true, error: null }))
    Promise.all([client.items.detail(itemId), client.items.versions(itemId)]).then(
      ([detail, versions]) => {
        if (live) setState({ id: itemId, detail, versions, loading: false, error: null })
      },
      (e: unknown) => {
        if (!live) return
        const code = (e as { code?: string }).code
        setState({ id: itemId, detail: null, versions: [], loading: false, error: { key: code ? (`error.${code}` as Notice['key']) : 'error.internal' } })
      },
    )
    return () => {
      live = false
    }
  }, [itemId, client, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const current = state.id === itemId
  return {
    detail: current ? state.detail : null,
    versions: current ? state.versions : [],
    loading: !current || state.loading,
    error: current ? state.error : null,
    gone: !stillShared,
    reload,
  }
}
