import type { FetchLike, WebSocketCtor, WebSocketLike } from '@tiger/client'
import {
  type ApiErrorCode,
  type ApiRouteName,
  api,
  canonicalUrl as canonical,
  type Item,
  type Message,
  type ServerEvent,
  type Space,
  type Thread,
} from '@tiger/shared'
import { at, type FixtureWorld, me, NOW, uid } from './fixtures'

/**
 * A fixture-backed stand-in for the Tiger server: a `fetch` that answers every REST route of the
 * contract from a FixtureWorld, and a WebSocket class that speaks the realtime protocol. The real
 * @tiger/client runs on top of it unchanged (with response validation on), so hooks are tested
 * through the same stores and code paths as in the app.
 *
 * Mutations change the world and push the socket events the real server would.
 */

export interface RecordedRequest {
  route: ApiRouteName
  method: string
  path: string
  body: unknown
}

export interface FixtureServer {
  fetch: FetchLike
  WebSocket: WebSocketCtor
  requests: RecordedRequest[]
  /** Push a server event to every authenticated socket. */
  push(event: ServerEvent): void
  /** Make a route fail with an API error until cleared. */
  failRoute(route: ApiRouteName, code: ApiErrorCode, status?: number): void
  clearFailures(): void
  /** Hold every response of a route until `release` (to observe loading states). */
  holdRoute(route: ApiRouteName): () => void
  /** The server cannot be reached: requests fail at the network, sockets drop and cannot reconnect. */
  setOffline(offline: boolean): void
  world: FixtureWorld
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
  ) {
    super(code)
  }
}

type Params = Record<string, string>
interface Req {
  params: Params
  query: URLSearchParams
  body: unknown
  token: string | null
}

const compiled = (Object.keys(api) as ApiRouteName[]).map((name) => {
  const def = api[name]
  const keys: string[] = []
  const pattern = def.path.replace(/:([A-Za-z]+)/g, (_, k: string) => {
    keys.push(k)
    return '([^/]+)'
  })
  return { name, method: def.method, re: new RegExp(`^${pattern}$`), keys }
})

export function createFixtureServer(world: FixtureWorld): FixtureServer {
  const requests: RecordedRequest[] = []
  const failures = new Map<ApiRouteName, { code: ApiErrorCode; status: number }>()
  const holds = new Map<ApiRouteName, Promise<void>>()
  const sockets = new Set<FakeSocket>()
  let offline = false
  let seq = 9000
  const nextId = () => uid(++seq)
  const nowIso = () => new Date(NOW + (seq - 9000) * 1000).toISOString()

  const push = (event: ServerEvent) => {
    for (const s of sockets) s.deliver(event)
  }
  const space = (id: string): Space => {
    const s = world.spaces.find((x) => x.id === id)
    if (!s) throw new HttpError(404, 'space_not_found')
    return s
  }
  const thread = (id: string): Thread => {
    const t = world.threads.find((x) => x.id === id)
    if (!t) throw new HttpError(404, 'thread_not_found')
    return t
  }
  const fixtureItem = (id: string) => {
    const it = world.items.find((x) => x.item.id === id)
    if (!it) throw new HttpError(404, 'item_not_found')
    return it
  }
  const indexEntry = (item: Item) => ({
    itemId: item.id,
    spaceId: item.spaceId,
    urlKey: canonical(item.url),
    title: item.title,
    sharedBy: item.sharedBy,
    versionNumber: item.currentVersion.number,
    contentHash: item.currentVersion.contentHash,
    updatedAt: item.updatedAt,
  })

  const handlers: Partial<Record<ApiRouteName, (r: Req) => unknown | Promise<unknown>>> = {
    health: () => ({ ok: true, version: 'fixture' }),
    authDev: (r) => {
      const b = r.body as { email: string; name: string }
      return { token: world.token, user: { ...me, email: b.email, name: b.name } }
    },
    authGoogle: () => ({ token: world.token, user: me }),
    authLogout: () => ({ ok: true }),
    me: () => ({ user: world.me, spaces: world.spaces }),
    updateMe: (r) => {
      Object.assign(world.me, r.body as object)
      return world.me
    },
    listModels: () => world.models,
    listSpaces: () => world.spaces,
    createSpace: (r) => {
      const b = r.body as { name: string; hue?: Space['hue'] }
      const s: Space = {
        id: nextId(),
        name: b.name,
        hue: b.hue ?? 'graphite',
        createdBy: world.me.id,
        createdAt: nowIso(),
        memberCount: 1,
        itemCount: 0,
        myRole: 'owner',
      }
      world.spaces.push(s)
      world.members[s.id] = [
        {
          user: { id: me.id, name: me.name, avatarUrl: null, email: me.email },
          role: 'owner',
          joinedAt: s.createdAt,
        },
      ]
      return s
    },
    getSpace: (r) => {
      const s = space(r.params.spaceId as string)
      return {
        space: s,
        members: world.members[s.id] ?? [],
        pendingInvites: world.invites[s.id] ?? [],
      }
    },
    updateSpace: (r) => {
      const s = space(r.params.spaceId as string)
      Object.assign(s, r.body as object)
      push({ type: 'space.updated', spaceId: s.id, name: s.name, hue: s.hue })
      return s
    },
    createInvite: (r) => {
      const s = space(r.params.spaceId as string)
      const b = r.body as { email?: string }
      const invite = {
        id: nextId(),
        spaceId: s.id,
        email: b.email ?? null,
        createdBy: { id: me.id, name: me.name, avatarUrl: null },
        createdAt: nowIso(),
        expiresAt: new Date(NOW + 14 * 86_400_000).toISOString(),
        acceptedAt: null,
      }
      world.invites[s.id] ??= []
      world.invites[s.id]?.push(invite)
      const token = `invite-token-${invite.id}`
      return { invite, token, url: `http://rig.tiger.invalid/invite#${token}` }
    },
    revokeInvite: (r) => {
      const list = world.invites[r.params.spaceId as string] ?? []
      world.invites[r.params.spaceId as string] = list.filter((i) => i.id !== r.params.inviteId)
      return { ok: true }
    },
    acceptInvite: () => world.spaces[2] as Space,
    removeMember: (r) => {
      const id = r.params.spaceId as string
      world.members[id] = (world.members[id] ?? []).filter((m) => m.user.id !== r.params.userId)
      push({ type: 'member.removed', spaceId: id, userId: r.params.userId as string })
      return { ok: true }
    },
    listItems: (r) =>
      world.items.filter((i) => i.item.spaceId === r.params.spaceId).map((i) => i.item),
    listItemIndex: () => world.items.map((i) => indexEntry(i.item)),
    getItem: (r) => {
      const it = fixtureItem(r.params.itemId as string)
      return { ...it.item, markdown: it.markdown, extractor: 'readability@1', lang: 'ja' }
    },
    listItemVersions: (r) => fixtureItem(r.params.itemId as string).versions,
    shareItem: async (r) => {
      const s = space(r.params.spaceId as string)
      const { page } = r.body as {
        page: { url: string; title: string; sourceType: Item['sourceType']; markdown: string }
      }
      const hash = await sha(page.markdown)
      const existing = world.items.find(
        (i) => i.item.spaceId === s.id && canonical(i.item.url) === canonical(page.url),
      )
      if (existing && existing.item.currentVersion.contentHash === hash)
        return { outcome: 'unchanged', item: existing.item }
      const version = {
        id: nextId(),
        number: existing ? existing.item.currentVersion.number + 1 : 1,
        charCount: page.markdown.length,
        contentHash: hash,
        capturedAt: nowIso(),
        capturedBy: { id: me.id, name: me.name, avatarUrl: null },
      }
      const item: Item = existing
        ? {
            ...existing.item,
            title: page.title,
            updatedAt: version.capturedAt,
            versionCount: version.number,
            currentVersion: version,
          }
        : {
            id: nextId(),
            spaceId: s.id,
            url: page.url,
            title: page.title,
            sourceType: page.sourceType,
            sharedBy: version.capturedBy,
            sharedAt: version.capturedAt,
            updatedAt: version.capturedAt,
            status: 'ready',
            versionCount: 1,
            currentVersion: version,
          }
      if (existing) {
        existing.item = item
        existing.markdown = page.markdown
        existing.versions.unshift(version)
      } else world.items.push({ item, markdown: page.markdown, versions: [version] })
      queueMicrotask(() => push({ type: 'item.upserted', item }))
      return { outcome: existing ? 'version' : 'new', item }
    },
    unshareItem: (r) => {
      const it = fixtureItem(r.params.itemId as string)
      world.items = world.items.filter((i) => i !== it)
      queueMicrotask(() =>
        push({
          type: 'item.deleted',
          spaceId: it.item.spaceId,
          itemId: it.item.id,
          url: it.item.url,
        }),
      )
      return { ok: true }
    },
    listAudit: (r) => world.audit[r.params.spaceId as string] ?? [],
    search: () => [],
    getUsage: (r) => {
      const u = world.usage[r.params.spaceId as string]
      if (!u) throw new HttpError(404, 'space_not_found')
      return u
    },
    listThreads: (r) => {
      const vis = r.query.get('visibility')
      return world.threads.filter(
        (t) =>
          t.spaceId === r.params.spaceId &&
          (t.visibility === 'space' || t.owner.id === me.id) &&
          (!vis || t.visibility === vis),
      )
    },
    createThread: (r) => {
      const b = r.body as { visibility: Thread['visibility']; title?: string }
      const t: Thread = {
        id: nextId(),
        spaceId: space(r.params.spaceId as string).id,
        visibility: b.visibility,
        owner: { id: me.id, name: me.name, avatarUrl: null },
        title: b.title ?? '',
        createdAt: nowIso(),
        lastMessageAt: null,
      }
      world.threads.unshift(t)
      world.messages[t.id] = []
      return t
    },
    listMessages: (r) => {
      const t = thread(r.params.threadId as string)
      const all = world.messages[t.id] ?? []
      const before = r.query.get('before')
      const limit = Number(r.query.get('limit') ?? 50)
      const end = before ? all.findIndex((m) => m.id === before) : all.length
      return all.slice(
        Math.max(0, (end === -1 ? all.length : end) - limit),
        end === -1 ? all.length : end,
      )
    },
    postMessage: (r) => {
      const t = thread(r.params.threadId as string)
      const b = r.body as {
        content: string
        askAi: boolean
        model?: Message['model']
        attachments?: {
          url: string
          title: string
          sourceType: Item['sourceType']
          markdown: string
        }[]
      }
      if (t.visibility === 'space' && b.attachments?.length)
        throw new HttpError(400, 'attachments_not_allowed')
      const author = { id: me.id, name: me.name, avatarUrl: null }
      const base = {
        threadId: t.id,
        author,
        citations: [] as Message['citations'],
        errorCode: null,
        usage: null,
        streamSeq: null,
      }
      const message: Message = {
        ...base,
        id: nextId(),
        role: 'user',
        model: null,
        content: b.content,
        attachments: (b.attachments ?? []).map((a) => ({
          url: a.url,
          title: a.title,
          sourceType: a.sourceType,
          charCount: a.markdown.length,
        })),
        status: 'complete',
        createdAt: nowIso(),
      }
      const assistantMessage: Message | null = b.askAi
        ? {
            ...base,
            id: nextId(),
            role: 'assistant',
            model: b.model ?? world.models.defaultModel,
            content: '',
            attachments: [],
            status: 'streaming',
            streamSeq: 0,
            createdAt: nowIso(),
          }
        : null
      world.messages[t.id] ??= []
      const list = world.messages[t.id] as NonNullable<(typeof world.messages)[string]>
      list.push(message)
      if (assistantMessage) list.push(assistantMessage)
      t.lastMessageAt = message.createdAt
      return { message, assistantMessage }
    },
    shareThread: (r) => {
      const t = thread(r.params.threadId as string)
      if (t.visibility !== 'private') throw new HttpError(409, 'already_shared')
      const copy: Thread = { ...t, id: nextId(), visibility: 'space', createdAt: nowIso() }
      world.threads.unshift(copy)
      const b = r.body as { includeAttachedMessageIds: string[]; excludeMessageIds: string[] }
      world.messages[copy.id] = (world.messages[t.id] ?? [])
        .filter((m) => !b.excludeMessageIds.includes(m.id))
        .map((m) => ({ ...m, id: nextId(), threadId: copy.id, attachments: [] }))
      return copy
    },
    deleteThread: (r) => {
      const t = thread(r.params.threadId as string)
      world.threads = world.threads.filter((x) => x !== t)
      return { ok: true }
    },
    abortMessage: (r) => {
      for (const list of Object.values(world.messages)) {
        const m = list.find((x) => x.id === r.params.messageId)
        if (m && m.status === 'streaming') {
          m.status = 'error'
          m.errorCode = 'ai_aborted'
          m.streamSeq = null
          const t = thread(m.threadId)
          queueMicrotask(() =>
            push({
              type: 'message.failed',
              spaceId: t.spaceId,
              threadId: t.id,
              messageId: m.id,
              code: 'ai_aborted',
              message: 'stopped',
            }),
          )
        }
      }
      return { ok: true }
    },
    recordExport: () => ({ ok: true }),
  }

  const fetchImpl: FetchLike = async (input, init) => {
    if (offline) throw new TypeError('Failed to fetch')
    const url = new URL(input)
    const method = (init.method ?? 'GET').toUpperCase()
    const route = compiled.find((c) => c.method === method && c.re.test(url.pathname))
    if (!route) return json(404, { error: { code: 'not_found', message: 'no such route' } })
    const match = route.re.exec(url.pathname) as RegExpExecArray
    const params: Params = Object.fromEntries(
      route.keys.map((k, i) => [k, decodeURIComponent(match[i + 1] as string)]),
    )
    const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined
    requests.push({ route: route.name, method, path: url.pathname, body })
    const hold = holds.get(route.name)
    if (hold) await hold
    const fail = failures.get(route.name)
    if (fail) return json(fail.status, { error: { code: fail.code, message: fail.code } })
    const headers = new Headers(init.headers)
    const token = headers.get('authorization')?.replace(/^Bearer /, '') ?? null
    if (api[route.name].auth && token !== world.token)
      return json(401, { error: { code: 'unauthenticated', message: 'unauthenticated' } })
    const handler = handlers[route.name]
    if (!handler) return json(404, { error: { code: 'not_found', message: route.name } })
    try {
      return json(200, await handler({ params, query: url.searchParams, body, token }))
    } catch (e) {
      if (e instanceof HttpError)
        return json(e.status, { error: { code: e.code, message: e.code } })
      throw e
    }
  }

  class FakeSocket implements WebSocketLike {
    readyState = 0
    private listeners = new Map<string, Set<(e: unknown) => void>>()
    private authed = false
    constructor(readonly url: string) {
      sockets.add(this)
      setTimeout(() => {
        if (this.readyState !== 0) return
        if (offline) {
          this.close(1006, 'offline')
          return
        }
        this.readyState = 1
        this.fire('open', {})
      }, 0)
    }
    send(data: string): void {
      const frame = JSON.parse(data) as { type: string; token?: string; spaceIds?: string[] }
      if (frame.type === 'auth') {
        if (frame.token !== world.token) {
          this.close(4401, 'unauthorized')
          return
        }
        this.authed = true
        this.reply({ type: 'ready', userId: me.id })
      } else if (frame.type === 'subscribe')
        this.reply({ type: 'subscribed', spaceIds: frame.spaceIds ?? [] })
      else if (frame.type === 'ping') this.reply({ type: 'pong' })
    }
    close(code = 1000, reason = ''): void {
      if (this.readyState >= 2) return
      this.readyState = 3
      sockets.delete(this)
      setTimeout(() => this.fire('close', { code, reason }), 0)
    }
    addEventListener(
      type: 'open' | 'message' | 'close' | 'error',
      listener: (event: unknown) => void,
    ): void {
      let set = this.listeners.get(type)
      if (!set) {
        set = new Set()
        this.listeners.set(type, set)
      }
      set.add(listener)
    }
    deliver(event: ServerEvent): void {
      if (this.authed && this.readyState === 1) this.reply(event)
    }
    private reply(event: ServerEvent): void {
      setTimeout(() => this.fire('message', { data: JSON.stringify(event) }), 0)
    }
    private fire(type: string, event: unknown): void {
      for (const l of [...(this.listeners.get(type) ?? [])]) l(event)
    }
  }

  return {
    fetch: fetchImpl,
    WebSocket: FakeSocket as unknown as WebSocketCtor,
    requests,
    push,
    failRoute(route, code, status = 500) {
      failures.set(route, { code, status })
    },
    clearFailures: () => failures.clear(),
    setOffline(next) {
      offline = next
      if (next) for (const s of [...sockets]) s.close(1006, 'offline')
    },
    holdRoute(route) {
      let release!: () => void
      holds.set(
        route,
        new Promise<void>((r) => {
          release = r
        }),
      )
      return () => {
        holds.delete(route)
        release()
      }
    },
    world,
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function sha(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export { at }
