import { type CreatedInvite, errorKey, type Load } from '@tiger/client'
import type {
  AuditEvent,
  Invite,
  Space,
  SpaceHue,
  SpaceMember,
  SpaceUsage,
} from '@tiger/shared'
import { useEffect, useMemo } from 'react'
import { useServices } from '../app/context'
import type { Notice } from '../i18n'
import { shallow, useStore } from '../lib/store'

const noticeOf = (load: Load): Notice | null =>
  load.status === 'error' && load.error ? { key: errorKey(load.error) } : null

export interface SpacesView {
  list: Space[]
  current: Space | null
  loading: boolean
  error: Notice | null
  /** A create/rename/invite/remove in flight, and its failure. */
  busy: boolean
  mutationError: Notice | null
  select(spaceId: string | null): Promise<void>
  create(name: string, hue?: SpaceHue): Promise<Space | null>
  rename(spaceId: string, name: string): Promise<Space | null>
  recolor(spaceId: string, hue: SpaceHue): Promise<Space | null>
  refresh(): Promise<void>
}

export function useSpaces(): SpacesView {
  const { client } = useServices()
  const s = useStore(
    client.spaces.store,
    (x) => ({ list: x.list, currentSpaceId: x.currentSpaceId, load: x.load, mutation: x.mutation }),
    shallow,
  )
  return useMemo(
    () => ({
      list: s.list,
      current: s.list.find((x) => x.id === s.currentSpaceId) ?? null,
      loading: s.load.status === 'loading',
      error: noticeOf(s.load),
      busy: s.mutation.status === 'loading',
      mutationError: noticeOf(s.mutation),
      select: (id) => client.spaces.select(id),
      create: (name, hue) => client.spaces.create(name, hue),
      rename: (id, name) => client.spaces.update(id, { name }),
      recolor: (id, hue) => client.spaces.update(id, { hue }),
      refresh: () => client.spaces.refresh(),
    }),
    [s, client],
  )
}

export interface MembersView {
  spaceId: string | null
  members: SpaceMember[]
  pendingInvites: Invite[]
  /** The invite just created: its link is shown once. */
  lastInvite: CreatedInvite | null
  isOwner: boolean
  meId: string | null
  loading: boolean
  error: Notice | null
  createInvite(email?: string): Promise<CreatedInvite | null>
  copyInviteLink(): Promise<boolean>
  revokeInvite(inviteId: string): Promise<boolean>
  removeMember(userId: string): Promise<boolean>
  reload(): Promise<void>
}

/** Members and invites of the current Space; loads them when the Space changes. */
export function useMembers(): MembersView {
  const { client, bridge } = useServices()
  const s = useStore(
    client.spaces.store,
    (x) => ({
      currentSpaceId: x.currentSpaceId,
      list: x.list,
      detail: x.detail,
      detailLoad: x.detailLoad,
      lastInvite: x.lastInvite,
    }),
    shallow,
  )
  const meId = useStore(client.session.store, (x) => x.user?.id ?? null)
  useEffect(() => {
    if (s.currentSpaceId && s.detail?.spaceId !== s.currentSpaceId && s.detailLoad.status !== 'loading')
      void client.spaces.loadDetail(s.currentSpaceId)
  }, [s.currentSpaceId, s.detail?.spaceId, s.detailLoad.status, client])
  return useMemo(() => {
    const detail = s.detail && s.detail.spaceId === s.currentSpaceId ? s.detail : null
    const current = s.list.find((x) => x.id === s.currentSpaceId)
    return {
      spaceId: s.currentSpaceId,
      members: detail?.members ?? [],
      pendingInvites: (detail?.pendingInvites ?? []).filter((i) => !i.acceptedAt),
      lastInvite: s.lastInvite,
      isOwner: current?.myRole === 'owner',
      meId,
      loading: s.detailLoad.status === 'loading',
      error: noticeOf(s.detailLoad),
      createInvite: (email) => client.spaces.createInvite(email),
      async copyInviteLink() {
        const url = client.spaces.store.getState().lastInvite?.url
        if (!url) return false
        return bridge.invoke('clipboard.writeText', { text: url }).then(
          () => true,
          () => false,
        )
      },
      revokeInvite: (id) => client.spaces.revokeInvite(id),
      removeMember: (id) => client.spaces.removeMember(id),
      reload: () => client.spaces.loadDetail(),
    }
  }, [s, meId, client, bridge])
}

export interface InviteView {
  /** An invite link the member opened (engine `invite.open`), waiting for an answer. */
  pending: { token: string } | null
  busy: boolean
  error: Notice | null
  accept(): Promise<Space | null>
  dismiss(): void
  /** Accept a link the member pasted. */
  acceptLink(linkOrToken: string): Promise<Space | null>
}

export function useInvite(): InviteView {
  const { client } = useServices()
  const s = useStore(
    client.spaces.store,
    (x) => ({ pending: x.pendingInvite, mutation: x.mutation }),
    shallow,
  )
  return useMemo(
    () => ({
      pending: s.pending,
      busy: s.mutation.status === 'loading',
      error: noticeOf(s.mutation),
      accept: () => client.spaces.acceptPendingInvite(),
      dismiss: () => client.spaces.dismissPendingInvite(),
      acceptLink: (link) => client.spaces.acceptInvite(link),
    }),
    [s, client],
  )
}

export interface ActivityView {
  audit: AuditEvent[]
  usage: SpaceUsage | null
  /** Share of the budget used (0..1), null when unlimited or unknown. */
  usageRatio: number | null
  loading: boolean
  error: Notice | null
  reload(): Promise<void>
}

export function useActivity(): ActivityView {
  const { client } = useServices()
  const s = useStore(client.activity.store, (x) => x, shallow)
  return useMemo(() => {
    const u = s.usage
    return {
      audit: s.audit,
      usage: u,
      usageRatio:
        u?.budgetTokens ? Math.min(1, (u.inputTokens + u.outputTokens) / u.budgetTokens) : null,
      loading: s.auditLoad.status === 'loading',
      error: noticeOf(s.auditLoad),
      reload: () => client.activity.reload(),
    }
  }, [s, client])
}
