import { canonicalUrl } from '@tiger/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTigerClient, type TigerClient, type WebSocketCtor } from '../src'
import { waitFor } from './helpers/client'
import { FakeBridge, makePage, makeTab } from './helpers/fake-bridge'
import { startServer, type TestServer } from './helpers/server'

/**
 * Default private, checked at the network boundary: every request the client makes goes through a
 * spying fetch that refuses (and records) any request carrying the URL of an open tab that the
 * member did not explicitly share or attach. The share-state of tabs must still work, from the
 * local index alone.
 */

const SHARED = 'https://news.example.com/kiji?id=42&utm_source=x'
const ATTACHED = 'https://notes.example.net/my-draft?v=3'
const SECRETS = [
  'https://shop.example.net/cart?item=secret-777',
  'https://shop.example.net/after-navigation?q=private-search',
  'https://diary.example.org/private-entry', // private window
  'https://direct.bk.mufg.jp/account', // banking, blocked
]

/** Every way a URL could plausibly appear in a request line or body. */
function forms(url: string): string[] {
  const c = canonicalUrl(url)
  const u = new URL(url)
  return [
    url,
    c,
    encodeURIComponent(url),
    encodeURIComponent(c),
    `${u.host}${u.pathname}`,
    JSON.stringify(url).slice(1, -1),
  ]
}

const carries = (text: string, url: string) => forms(url).some((f) => text.includes(f))

interface Seen {
  method: string
  url: string
  body: string
}

let server: TestServer
let client: TigerClient
let bridge: FakeBridge
const seen: Seen[] = []
const frames: string[] = []
const violations: string[] = []

beforeAll(async () => {
  server = await startServer()
  bridge = new FakeBridge()
  const Native = globalThis.WebSocket as unknown as new (url: string) => WebSocket
  class SpyingWebSocket extends Native {
    override send(data: string): void {
      frames.push(data)
      super.send(data)
    }
  }
  client = createTigerClient({
    serverUrl: server.url,
    bridge,
    WebSocket: SpyingWebSocket as unknown as WebSocketCtor,
    fetch: async (input, init) => {
      const method = init.method ?? 'GET'
      const body = typeof init.body === 'string' ? init.body : ''
      const path = new URL(input).pathname
      seen.push({ method, url: input, body })
      const line = `${input}\n${body}`
      for (const secret of SECRETS) {
        if (carries(line, secret)) violations.push(`${method} ${path} carried ${secret}`)
      }
      // The shared page may leave only in the share request, the attached page only in its message.
      const sharePost = method === 'POST' && /^\/v1\/spaces\/[^/]+\/items$/.test(path)
      const messagePost = method === 'POST' && /^\/v1\/threads\/[^/]+\/messages$/.test(path)
      if (carries(line, SHARED) && !sharePost) violations.push(`${method} ${path} carried SHARED`)
      if (carries(line, ATTACHED) && !messagePost)
        violations.push(`${method} ${path} carried ATTACHED`)
      if (violations.length) throw new Error(`privacy violation: ${violations.at(-1)}`)
      return fetch(input, init)
    },
  })
})

afterAll(async () => {
  client?.dispose()
  const t=Date.now()
  await server?.app.close(); console.log('app closed', Date.now()-t)
  await server?.sql.end({timeout:5}); console.log('sql ended', Date.now()-t)
})

describe('no URL of an open tab leaves the machine unless the member shares or attaches it', () => {
  it('runs a whole session with tabs open, and the spying fetch never sees an unshared tab URL', async () => {
    await client.start()
    await client.session.devLogin(`privacy.${Date.now()}@example.com`, 'Privacy')
    const space = await client.spaces.create('Private by default')
    await client.spaces.select(space?.id as string)
    await waitFor(() => client.ui.getState().connection === 'online', 5000, 'online')

    bridge.setTabs([
      makeTab('pub', SHARED),
      makeTab('open', SECRETS[0] as string),
      makeTab('priv', SECRETS[2] as string, { isPrivate: true }),
      makeTab('bank', SECRETS[3] as string),
      makeTab('att', ATTACHED),
    ])
    await client.urlShare.whenReady()
    for (const id of ['pub', 'open', 'priv', 'bank', 'att']) {
      expect(client.urlShare.forTab(id), id).toMatchObject({ status: 'ready', locations: [] })
    }

    // Preview first: nothing leaves. Then the explicit confirm sends the page.
    bridge.captures.set('pub', { ok: true, page: makePage(SHARED, '# 記事\n\n共有する本文です。') })
    await client.share.begin('pub')
    expect(client.share.store.getState().phase).toBe('preview')
    expect(seen.some((r) => carries(`${r.url}\n${r.body}`, SHARED))).toBe(false)
    expect(await client.share.confirm()).toBe(true)
    expect(client.urlShare.forTab('pub')?.locations).toHaveLength(1)
    expect(client.urlShare.forTab('open')?.locations).toEqual([])

    // A tab navigates; a stale check runs; both are local.
    bridge.setTabs([
      makeTab('pub', SHARED),
      makeTab('open', SECRETS[1] as string),
      makeTab('priv', SECRETS[2] as string, { isPrivate: true }),
      makeTab('bank', SECRETS[3] as string),
      makeTab('att', ATTACHED),
    ])
    expect((await client.share.checkStale('pub')).status).toBe('fresh')

    // An AI answer in the Space thread, then a page attached to a private-thread message.
    const thread = await client.threads.createSpaceThread('質問')
    const asked = await client.threads.post(thread?.id as string, '要点は?', { askAi: true })
    const answerId = asked?.assistantMessage?.id as string
    await waitFor(
      () =>
        client.threads.store
          .getState()
          .messages[thread?.id as string]?.list.find((m) => m.id === answerId)?.phase ===
        'complete',
      8000,
      'answer',
    )
    bridge.captures.set('att', { ok: true, page: makePage(ATTACHED, '# 下書き\n\n私的なメモ。') })
    const priv = await client.threads.ensurePrivateThread()
    await client.threads.beginAttach(priv?.id as string, 'att')
    expect(client.threads.confirmAttach()).toBe(true)
    expect(await client.threads.post(priv?.id as string, 'まとめて', { askAi: false })).not.toBeNull()

    // A reconnect refetches the index; still nothing about the tabs is sent.
    client.realtime.reconnectNow()
    await waitFor(() => client.ui.getState().connection === 'online', 5000, 'online again')
    await server.settle()

    expect(violations).toEqual([])
    for (const f of frames) for (const url of [SHARED, ATTACHED, ...SECRETS]) {
      expect(carries(f, url), `socket frame ${f}`).toBe(false)
    }
    // The index is fetched with a bare GET: no query, no body.
    const indexCalls = seen.filter((r) => new URL(r.url).pathname === '/v1/items/index')
    expect(indexCalls.length).toBeGreaterThanOrEqual(1)
    for (const r of indexCalls) {
      expect(r.method).toBe('GET')
      expect(new URL(r.url).search).toBe('')
      expect(r.body).toBe('')
    }
    // The shared page went out exactly once, in its share request.
    expect(seen.filter((r) => carries(`${r.url}\n${r.body}`, SHARED))).toHaveLength(1)
    expect(seen.filter((r) => carries(`${r.url}\n${r.body}`, ATTACHED))).toHaveLength(1)
  })

  it('the spy itself works: a request carrying a tab URL is refused and recorded', async () => {
    const before = violations.length
    await expect(
      client.threads.post(client.threads.store.getState().threads[0]?.id as string, SECRETS[0] as string, {
        askAi: false,
      }),
    ).resolves.toBeNull()
    expect(violations.length).toBe(before + 1)
    violations.length = before
  })
})
