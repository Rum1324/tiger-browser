import { api } from '@tiger/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ApiClientError, createApiClient, type FetchLike } from '../src'
import { startServer, type TestServer } from './helpers/server'

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(async () => {
  await server.close()
})

const caught = async (p: Promise<unknown>): Promise<ApiClientError> => {
  try {
    await p
  } catch (e) {
    if (e instanceof ApiClientError) return e
    throw e
  }
  throw new Error('expected a failure')
}

describe('typed API client against the real server', () => {
  it('calls routes with typed input and output, sending the bearer token from the getter', async () => {
    let token: string | null = null
    const client = createApiClient({ serverUrl: `${server.url}/`, getToken: () => token })
    const health = await client.call(api.health, {})
    expect(health.ok).toBe(true)
    const session = await client.call(api.authDev, {
      body: { email: 'api@example.com', name: 'Api' },
    })
    token = session.token
    const space = await client.call(api.createSpace, { body: { name: 'API', hue: 'sky' } })
    const detail = await client.call(api.getSpace, { params: { spaceId: space.id } })
    expect(detail.members[0]?.user.email).toBe('api@example.com')
    const audit = await client.call(api.listAudit, {
      params: { spaceId: space.id },
      query: { limit: 5 },
    })
    expect(audit[0]?.action).toBe('space.created')
  })

  it('server errors carry the ApiErrorCode and status', async () => {
    let token: string | null = null
    const client = createApiClient({ serverUrl: server.url, getToken: () => token })
    token = (await client.call(api.authDev, { body: { email: 'err@example.com', name: 'Err' } }))
      .token
    const e = await caught(
      client.call(api.getSpace, { params: { spaceId: '0197a000-0000-7000-8000-00000000dead' } }),
    )
    expect(e).toMatchObject({
      kind: 'server',
      code: 'space_not_found',
      status: 404,
      route: 'getSpace',
    })
    const bad = await caught(client.call(api.createSpace, { body: { name: '' } }))
    expect(bad).toMatchObject({ kind: 'server', code: 'invalid_request', status: 400 })
  })

  it('an expired session reports unauthenticated and calls the hook', async () => {
    let hooked = 0
    const client = createApiClient({
      serverUrl: server.url,
      getToken: () => 'z'.repeat(43),
      onUnauthenticated: () => hooked++,
    })
    const e = await caught(client.call(api.me, {}))
    expect(e).toMatchObject({ kind: 'server', code: 'unauthenticated', status: 401 })
    expect(hooked).toBe(1)
  })

  it('an authenticated route with no token is refused locally, without a request', async () => {
    let requests = 0
    const fetch: FetchLike = async (i, init) => {
      requests++
      return globalThis.fetch(i, init)
    }
    const client = createApiClient({ serverUrl: server.url, getToken: () => null, fetch })
    const e = await caught(client.call(api.listSpaces, {}))
    expect(e).toMatchObject({ kind: 'client', code: 'unauthenticated' })
    expect(requests).toBe(0)
  })
})

describe('failures that are not server errors', () => {
  it('a network failure is distinguished from a server error', async () => {
    const client = createApiClient({ serverUrl: 'http://127.0.0.1:9', getToken: () => null })
    const e = await caught(client.call(api.health, {}))
    expect(e).toMatchObject({ kind: 'network', code: 'network', status: null })
    expect(e.isNetwork).toBe(true)
  })

  it('a cancelled request reports aborted', async () => {
    const client = createApiClient({ serverUrl: server.url, getToken: () => null })
    const ctl = new AbortController()
    ctl.abort()
    const e = await caught(client.call(api.health, {}, { signal: ctl.signal }))
    expect(e).toMatchObject({ kind: 'aborted', code: 'aborted' })
  })

  it('a non-JSON gateway error is a server error with code internal', async () => {
    const fetch: FetchLike = async () => new Response('<html>Bad gateway</html>', { status: 502 })
    const client = createApiClient({ serverUrl: 'http://x.test', getToken: () => null, fetch })
    expect(await caught(client.call(api.health, {}))).toMatchObject({
      kind: 'server',
      code: 'internal',
      status: 502,
    })
  })

  it('an unknown error code from the server maps to internal', async () => {
    const fetch: FetchLike = async () =>
      Response.json({ error: { code: 'brand_new_code', message: 'x' } }, { status: 418 })
    const client = createApiClient({ serverUrl: 'http://x.test', getToken: () => null, fetch })
    expect(await caught(client.call(api.health, {}))).toMatchObject({
      kind: 'server',
      code: 'internal',
    })
  })

  it('responses are validated against the contract in development and test, not in production', async () => {
    const fetch: FetchLike = async () => Response.json({ ok: 'yes', version: 1 })
    const checked = createApiClient({ serverUrl: 'http://x.test', getToken: () => null, fetch })
    expect(await caught(checked.call(api.health, {}))).toMatchObject({
      kind: 'contract',
      code: 'contract_violation',
    })
    const unchecked = createApiClient({
      serverUrl: 'http://x.test',
      getToken: () => null,
      fetch,
      validate: false,
    })
    expect(await unchecked.call(api.health, {})).toEqual({ ok: 'yes', version: 1 })
  })

  it('query parameters and path parameters are encoded', async () => {
    const seen: string[] = []
    const fetch: FetchLike = async (url) => {
      seen.push(url)
      return Response.json([])
    }
    const client = createApiClient({
      serverUrl: 'http://x.test',
      getToken: () => 't'.repeat(30),
      fetch,
    })
    await client.call(api.listMessages, {
      params: { threadId: '0197a000-0000-7000-8000-000000000001' },
      query: { before: 'a b', limit: 10 },
    })
    expect(seen[0]).toBe(
      'http://x.test/v1/threads/0197a000-0000-7000-8000-000000000001/messages?before=a+b&limit=10',
    )
  })
})
