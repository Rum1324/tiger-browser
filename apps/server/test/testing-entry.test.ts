import { readFileSync } from 'node:fs'
import { ServerEvent } from '@tiger/shared'
import { describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { createSql } from '../src/db/sql'
import {
  fakeGoogleIdToken,
  startTestServer,
  TEST_DATABASE_URL,
  type TestServer,
} from '../src/testing'

async function call<T>(
  s: TestServer,
  method: string,
  path: string,
  token?: string,
  body?: unknown,
) {
  const res = await fetch(`${s.url}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, body: (await res.json()) as T }
}

describe('@tiger/server/testing', () => {
  it('is exported from the package entry map', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(pkg.exports['./testing']).toBe('./src/testing.ts')
  })

  it('starts the real server with the mock provider and the hash embedder, then removes its schema', async () => {
    const s = await startTestServer({ mock: { chunkDelayMs: 0, chunkSize: 4 } })
    let closed = false
    try {
      expect((await call<{ ok: boolean }>(s, 'GET', '/v1/health')).body.ok).toBe(true)
      const google = await call<{ token: string; user: { email: string } }>(
        s,
        'POST',
        '/v1/auth/google',
        undefined,
        { idToken: fakeGoogleIdToken('g@example.com', 'G') },
      )
      expect(google.status).toBe(200)
      expect(google.body.user.email).toBe('g@example.com')

      const { body: login } = await call<{ token: string }>(s, 'POST', '/v1/auth/dev', undefined, {
        email: 'a@example.com',
        name: 'A',
      })
      const { body: space } = await call<{ id: string }>(s, 'POST', '/v1/spaces', login.token, {
        name: 'T',
      })
      const share = await call<{ outcome: string }>(
        s,
        'POST',
        `/v1/spaces/${space.id}/items`,
        login.token,
        {
          page: {
            url: 'https://example.com/a',
            title: 'A',
            sourceType: 'web',
            markdown: '# A\n\nThe launch is in April.',
            lang: 'en',
            byline: null,
            siteName: null,
            extractor: 'readability@1',
            capturedAt: new Date().toISOString(),
            charCount: 27,
            truncated: false,
          },
        },
      )
      expect(share.body.outcome).toBe('new')
      await s.settle()
      const index = await call<{ urlKey: string }[]>(s, 'GET', '/v1/items/index', login.token)
      expect(index.body).toHaveLength(1)

      // A WebSocket on the same port, then an answer from the mock provider with a citation.
      const ws = new WebSocket(`ws://127.0.0.1:${s.port}/v1/ws`)
      const events: ServerEvent[] = []
      ws.on('message', (raw) => events.push(ServerEvent.parse(JSON.parse(raw.toString()))))
      await new Promise((r) => ws.once('open', r))
      ws.send(JSON.stringify({ type: 'auth', token: login.token }))
      ws.send(JSON.stringify({ type: 'subscribe', spaceIds: [space.id] }))
      ws.send(JSON.stringify({ type: 'ping' }))
      for (let i = 0; i < 100 && !events.some((e) => e.type === 'pong'); i++) {
        await new Promise((r) => setTimeout(r, 10))
      }
      const { body: thread } = await call<{ id: string }>(
        s,
        'POST',
        `/v1/spaces/${space.id}/threads`,
        login.token,
        { visibility: 'space' },
      )
      await call(s, 'POST', `/v1/threads/${thread.id}/messages`, login.token, {
        content: 'When is the launch?',
        askAi: true,
      })
      await s.settle()
      // settle() resolves once the server has published; the frame may still be in flight.
      for (let i = 0; i < 200 && !events.some((e) => e.type === 'message.completed'); i++) {
        await new Promise((r) => setTimeout(r, 10))
      }
      const completed = events.find((e) => e.type === 'message.completed')
      expect(completed?.type === 'message.completed' && completed.message.model?.provider).toBe(
        'mock',
      )
      expect(completed?.type === 'message.completed' && completed.message.citations[0]?.n).toBe(1)
      expect(events.some((e) => e.type === 'message.delta')).toBe(true)

      s.dropSockets()
      await new Promise((r) => ws.once('close', r))
      await s.close()
      closed = true
      const check = createSql(TEST_DATABASE_URL, { max: 1 })
      const left = await check`select 1 from pg_namespace where nspname = ${s.schema}`
      await check.end()
      expect(left).toHaveLength(0)
    } finally {
      if (!closed) await s.close()
    }
  })
})
