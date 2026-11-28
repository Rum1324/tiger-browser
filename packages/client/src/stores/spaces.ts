import {
  api,
  type Invite,
  type InvitePreview,
  type ServerEvent,
  type Space,
  type SpaceHue,
  type SpaceMember,
} from '@tiger/shared'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { ApiClientError, toClientError } from '../api'
import { parseInviteToken } from '../invite'
import { type ClientContext, failed, IDLE, LOADING, type Load, READY } from '../load'

export interface SpaceDetail {
  spaceId: string
  members: SpaceMember[]
  pendingInvites: Invite[]
}

export interface CreatedInvite {
  invite: Invite
  /** Shown once: the server keeps only its hash. */
  token: string
  url: string
}

export interface SpacesState {
  list: Space[]
  load: Load
  currentSpaceId: string | null
  /** Members and pending invites of the current Space. */
  detail: SpaceDetail | null
  detailLoad: Load
  /** The last invite created in this session, so the UI can show its link once. */
  lastInvite: CreatedInvite | null
  /** State of the last mutation (create, rename, invite, accept...), for buttons and toasts. */
  mutation: Load
  /**
   * An invite the member opened (engine `invite.open`) or pasted (`previewInvite`), waiting for them
   * to accept it or put it aside. `preview` is what the server says about it (Space name, colour,
   * size, who invited, expiry) once `previewLoad` is ready; a refused token reads as a failed
   * `previewLoad` with the same error accepting would give. Nothing is joined until
   * `acceptPendingInvite()`.
   */
  pendingInvite: PendingInvite | null
}

export interface PendingInvite {
  token: string
  preview: InvitePreview | null
  previewLoad: Load
}

export interface SpacesController {
  store: StoreApi<SpacesState>
  current(): Space | null
  setList(spaces: Space[]): void
  refresh(): Promise<void>
  /** Picks the Space stored in the engine's settings, else the first one. */
  restoreCurrent(): Promise<void>
  select(spaceId: string | null): Promise<void>
  create(name: string, hue?: SpaceHue): Promise<Space | null>
  update(spaceId: string, patch: { name?: string; hue?: SpaceHue }): Promise<Space | null>
  loadDetail(spaceId?: string): Promise<void>
  createInvite(email?: string): Promise<CreatedInvite | null>
  revokeInvite(inviteId: string): Promise<boolean>
  /** Accepts a pasted invite link or bare token, then switches to the joined Space. */
  acceptInvite(linkOrToken: string): Promise<Space | null>
  /**
   * Look at an invite before joining: holds it as `pendingInvite` and loads its preview. Accepts a
   * pasted link or bare token; resolves to the preview, or null when the token is refused.
   */
  previewInvite(linkOrToken: string): Promise<InvitePreview | null>
  /** The engine reported an opened invite link: hold it and load its preview until the member decides. */
  offerInvite(token: string): void
  acceptPendingInvite(): Promise<Space | null>
  dismissPendingInvite(): void
  removeMember(userId: string): Promise<boolean>
  handleEvent(e: ServerEvent): void
  reset(): void
}

export interface SpacesHooks {
  /** The set of Space ids changed: the realtime client resubscribes. */
  listChanged(ids: string[]): void
  /** The current Space changed: dependent stores load. */
  currentChanged(spaceId: string | null): void
}

const initial = (): SpacesState => ({
  list: [],
  load: IDLE,
  currentSpaceId: null,
  detail: null,
  detailLoad: IDLE,
  lastInvite: null,
  mutation: IDLE,
  pendingInvite: null,
})

export function createSpaces(ctx: ClientContext, hooks: SpacesHooks): SpacesController {
  const store = createStore<SpacesState>()(initial)

  const setList = (list: Space[]) => {
    const before = store
      .getState()
      .list.map((s) => s.id)
      .join()
    store.setState({ list, load: READY })
    const ids = list.map((s) => s.id)
    if (ids.join() !== before) hooks.listChanged(ids)
  }
  const upsert = (space: Space) => {
    const list = store.getState().list
    const i = list.findIndex((s) => s.id === space.id)
    setList(i < 0 ? [...list, space] : list.map((s) => (s.id === space.id ? space : s)))
  }
  const patchSpace = (spaceId: string, patch: Partial<Space>) => {
    store.setState({
      list: store.getState().list.map((s) => (s.id === spaceId ? { ...s, ...patch } : s)),
    })
  }

  async function mutate<T>(fn: () => Promise<T>): Promise<T | null> {
    store.setState({ mutation: LOADING })
    try {
      const r = await fn()
      store.setState({ mutation: READY })
      return r
    } catch (e) {
      store.setState({ mutation: failed(toClientError(e)) })
      return null
    }
  }

  const controller: SpacesController = {
    store,
    current() {
      const { list, currentSpaceId } = store.getState()
      return list.find((s) => s.id === currentSpaceId) ?? null
    },
    setList,

    async refresh() {
      store.setState({ load: LOADING })
      try {
        setList(await ctx.api.call(api.listSpaces, {}))
        const { currentSpaceId, list } = store.getState()
        if (currentSpaceId && !list.some((s) => s.id === currentSpaceId)) {
          await controller.select(list[0]?.id ?? null)
        }
      } catch (e) {
        store.setState({ load: failed(toClientError(e)) })
      }
    },

    async restoreCurrent() {
      const settings = await ctx.bridge.invoke('settings.get')
      const { list } = store.getState()
      const stored = settings.lastSpaceId
      const pick = list.find((s) => s.id === stored)?.id ?? list[0]?.id ?? null
      await controller.select(pick)
    },

    async select(spaceId) {
      const prev = store.getState().currentSpaceId
      if (spaceId !== null && !store.getState().list.some((s) => s.id === spaceId)) return
      store.setState({ currentSpaceId: spaceId })
      if (prev !== spaceId) {
        store.setState({ detail: null, detailLoad: IDLE, lastInvite: null })
        hooks.currentChanged(spaceId)
      }
      // Persisted through the engine so the next launch opens the same Space.
      await ctx.bridge.invoke('settings.update', { lastSpaceId: spaceId })
      if (spaceId) await controller.loadDetail(spaceId)
    },

    create(name, hue) {
      return mutate(async () => {
        const space = await ctx.api.call(api.createSpace, {
          body: { name, ...(hue ? { hue } : {}) },
        })
        upsert(space)
        return space
      })
    },

    update(spaceId, patch) {
      return mutate(async () => {
        const space = await ctx.api.call(api.updateSpace, { params: { spaceId }, body: patch })
        upsert(space)
        return space
      })
    },

    async loadDetail(spaceId = store.getState().currentSpaceId ?? undefined) {
      if (!spaceId) return
      store.setState({ detailLoad: LOADING })
      try {
        const r = await ctx.api.call(api.getSpace, { params: { spaceId } })
        if (store.getState().currentSpaceId !== spaceId) return
        upsert(r.space)
        store.setState({
          detail: { spaceId, members: r.members, pendingInvites: r.pendingInvites },
          detailLoad: READY,
        })
      } catch (e) {
        if (store.getState().currentSpaceId === spaceId)
          store.setState({ detailLoad: failed(toClientError(e)) })
      }
    },

    createInvite(email) {
      const spaceId = store.getState().currentSpaceId
      return mutate(async () => {
        if (!spaceId) throw new ApiClientError('client', 'space_not_found', 'no current Space')
        const r = await ctx.api.call(api.createInvite, {
          params: { spaceId },
          body: email ? { email } : {},
        })
        const detail = store.getState().detail
        if (detail?.spaceId === spaceId) {
          store.setState({
            detail: { ...detail, pendingInvites: [r.invite, ...detail.pendingInvites] },
          })
        }
        store.setState({ lastInvite: r })
        return r
      })
    },

    async revokeInvite(inviteId) {
      const spaceId = store.getState().currentSpaceId
      const ok = await mutate(async () => {
        if (!spaceId) throw new ApiClientError('client', 'space_not_found', 'no current Space')
        await ctx.api.call(api.revokeInvite, { params: { spaceId, inviteId } })
        const detail = store.getState().detail
        if (detail?.spaceId === spaceId) {
          store.setState({
            detail: {
              ...detail,
              pendingInvites: detail.pendingInvites.filter((i) => i.id !== inviteId),
            },
          })
        }
        return true
      })
      return ok === true
    },

    async acceptInvite(linkOrToken) {
      const token = parseInviteToken(linkOrToken)
      if (!token) {
        // Refused locally: nothing token-shaped was pasted, so no request is made.
        store.setState({
          mutation: failed(new ApiClientError('client', 'invite_not_found', 'no invite token')),
        })
        return null
      }
      const space = await mutate(() => ctx.api.call(api.acceptInvite, { body: { token } }))
      if (space) {
        upsert(space)
        await controller.select(space.id)
      }
      return space
    },

    async previewInvite(linkOrToken) {
      const token = parseInviteToken(linkOrToken)
      if (!token) {
        store.setState({
          mutation: failed(new ApiClientError('client', 'invite_not_found', 'no invite token')),
        })
        return null
      }
      store.setState({ pendingInvite: { token, preview: null, previewLoad: LOADING } })
      // A later invite (or putting this one aside) wins over a preview that arrives late.
      const stillPending = () => store.getState().pendingInvite?.token === token
      try {
        const preview = await ctx.api.call(api.previewInvite, { body: { token } })
        if (stillPending()) {
          store.setState({ pendingInvite: { token, preview, previewLoad: READY } })
        }
        return preview
      } catch (e) {
        if (stillPending()) {
          store.setState({
            pendingInvite: { token, preview: null, previewLoad: failed(toClientError(e)) },
          })
        }
        return null
      }
    },

    offerInvite(token) {
      // A link with nothing token-shaped in it is ignored, as before: there is nothing to offer.
      if (parseInviteToken(token)) void controller.previewInvite(token)
    },

    async acceptPendingInvite() {
      const pending = store.getState().pendingInvite
      if (!pending) return null
      const space = await controller.acceptInvite(pending.token)
      // A refused invite stays visible with its error until dismissed; an accepted one is done.
      if (space) store.setState({ pendingInvite: null })
      return space
    },

    dismissPendingInvite() {
      store.setState({ pendingInvite: null })
    },

    async removeMember(userId) {
      const spaceId = store.getState().currentSpaceId
      const ok = await mutate(async () => {
        if (!spaceId) throw new ApiClientError('client', 'space_not_found', 'no current Space')
        await ctx.api.call(api.removeMember, { params: { spaceId, userId } })
        return true
      })
      return ok === true
    },

    handleEvent(e) {
      switch (e.type) {
        case 'space.updated':
          patchSpace(e.spaceId, { name: e.name, hue: e.hue })
          return
        case 'member.joined': {
          const space = store.getState().list.find((s) => s.id === e.spaceId)
          if (space) patchSpace(e.spaceId, { memberCount: space.memberCount + 1 })
          if (store.getState().currentSpaceId === e.spaceId) void controller.loadDetail(e.spaceId)
          return
        }
        case 'member.removed': {
          if (e.userId === ctx.userId()) {
            // This member was removed: the Space disappears from their list.
            setList(store.getState().list.filter((s) => s.id !== e.spaceId))
            if (store.getState().currentSpaceId === e.spaceId)
              void controller.select(store.getState().list[0]?.id ?? null)
            return
          }
          const space = store.getState().list.find((s) => s.id === e.spaceId)
          if (space) patchSpace(e.spaceId, { memberCount: Math.max(0, space.memberCount - 1) })
          const detail = store.getState().detail
          if (detail?.spaceId === e.spaceId) {
            store.setState({
              detail: { ...detail, members: detail.members.filter((m) => m.user.id !== e.userId) },
            })
          }
          return
        }
        default:
          return
      }
    },

    reset() {
      store.setState(initial(), true)
    },
  }
  return controller
}
