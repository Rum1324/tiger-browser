import { api, type RouteDef } from '@tiger/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { registerRoute } from '../src/http/registry'
import { type Harness, startHarness } from './helpers/harness'

let h: Harness
beforeAll(async () => {
  h = await startHarness()
  // A route whose handler drifts from its declared response, to prove drift fails loudly.
  const drifting: RouteDef<undefined, undefined, undefined, { n: number }> = {
    method: 'GET',
    path: '/v1/test/drift',
    auth: false,
    response: z.object({ n: z.number() }),
  }
  registerRoute(h.app, drifting, async () => ({ n: 'not a number' }) as unknown as { n: number })
})
afterAll(() => h.close())

describe('route registry', () => {
  it('registers every route of the contract', async () => {
    await h.app.ready()
    const missing = Object.entries(api)
      .filter(
        ([, def]) => !h.app.contractRoutes.has(def as RouteDef<unknown, unknown, unknown, unknown>),
      )
      .map(([name]) => name)
    expect(missing).toEqual([])
    for (const def of Object.values(api)) {
      expect(
        h.app.hasRoute({ method: def.method, url: def.path }),
        `${def.method} ${def.path}`,
      ).toBe(true)
    }
  })

  it('serves health without auth', async () => {
    expect(await h.ok('health', {})).toEqual({ ok: true, version: expect.any(String) })
  })

  it('rejects a protected route without a valid bearer token', async () => {
    await h.fails('me', {}, undefined, 401, 'unauthenticated')
    await h.fails('me', {}, 'x'.repeat(43), 401, 'unauthenticated')
  })

  it('validates params, query and body with the contract schemas', async () => {
    const { token } = await h.login('Val')
    await h.fails('getSpace', { params: { spaceId: 'not-a-uuid' } }, token, 400, 'invalid_request')
    await h.fails('createSpace', { body: { name: '' } }, token, 400, 'invalid_request')
    const space = await h.ok('createSpace', { body: { name: 'S' } }, token)
    const r = await h.app.inject({
      method: 'GET',
      url: `/v1/spaces/${space.id}/audit?limit=999`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(r.statusCode).toBe(400)
    expect(r.json().error.code).toBe('invalid_request')
  })

  it('answers unknown routes and malformed JSON with the ApiError shape', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/v1/nope' })
    expect(r.statusCode).toBe(404)
    expect(r.json()).toEqual({ error: { code: 'not_found', message: expect.any(String) } })
    const bad = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/dev',
      headers: { 'content-type': 'application/json' },
      payload: '{nope',
    })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.code).toBe('invalid_request')
  })

  it('fails a response that breaks its contract with contract_violation', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/v1/test/drift' })
    expect(r.statusCode).toBe(500)
    expect(r.json().error.code).toBe('contract_violation')
  })

  it('reports listModels as unavailable when the directory has no default', async () => {
    const { token } = await h.login('Models')
    await h.fails('listModels', {}, token, 503, 'ai_unavailable')
  })
})
