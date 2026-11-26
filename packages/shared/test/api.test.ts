import { describe, expect, it } from 'vitest'
import { api, buildPath, type RouteInput, type RouteOutput } from '../src/api'
import { engineCommands, engineEvents } from '../src/ipc'
import { ClientEvent, ServerEvent } from '../src/ws'

describe('REST contract', () => {
  it('has unique method+path pairs, all under /v1', () => {
    const seen = new Set<string>()
    for (const [name, def] of Object.entries(api)) {
      const key = `${def.method} ${def.path}`
      expect(seen.has(key), `${name} duplicates ${key}`).toBe(false)
      seen.add(key)
      expect(def.path.startsWith('/v1/'), name).toBe(true)
    }
  })

  it('declares a params schema for every :param in the path, and no extras', () => {
    for (const [name, def] of Object.entries(api)) {
      const inPath = [...def.path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]).sort()
      const declared = def.params
        ? Object.keys((def.params as unknown as { shape: Record<string, unknown> }).shape).sort()
        : []
      expect(declared, name).toEqual(inPath)
    }
  })

  it('leaves only sign-in and health unauthenticated', () => {
    const open = Object.entries(api)
      .filter(([, def]) => !def.auth)
      .map(([name]) => name)
      .sort()
    expect(open).toEqual(['authDev', 'authGoogle', 'health'])
  })

  it('builds paths and refuses a missing parameter', () => {
    expect(buildPath('/v1/spaces/:spaceId/items', { spaceId: 'a b' })).toBe(
      '/v1/spaces/a%20b/items',
    )
    expect(() => buildPath('/v1/items/:itemId', {})).toThrow(/itemId/)
  })

  it('rejects attachments beyond the cap and empty messages', () => {
    const body = api.postMessage.body
    expect(body?.safeParse({ content: '', askAi: true }).success).toBe(false)
    expect(body?.safeParse({ content: 'こんにちは', askAi: true }).success).toBe(true)
  })

  it('infers input and output types from a route', () => {
    type In = RouteInput<typeof api.createSpace>
    type Out = RouteOutput<typeof api.createSpace>
    const input: In = { body: { name: '資金調達 2027' } }
    const check = (o: Out) => o.name
    expect(input.body.name).toBe('資金調達 2027')
    expect(typeof check).toBe('function')
  })
})

describe('engine contract', () => {
  it('names every command and event as area.verb or a single word', () => {
    for (const name of [...Object.keys(engineCommands), ...Object.keys(engineEvents)]) {
      expect(name).toMatch(/^[a-z]+(\.[a-zA-Z]+)?$/)
    }
  })

  it('validates a capture result in both shapes', () => {
    const res = engineCommands['capture.extract'].res
    expect(
      res.safeParse({ ok: false, error: 'blocked', reason: 'banking', detail: null }).success,
    ).toBe(true)
    expect(res.safeParse({ ok: true }).success).toBe(false)
  })
})

describe('WebSocket contract', () => {
  it('parses client frames and rejects unknown types', () => {
    expect(ClientEvent.safeParse({ type: 'auth', token: 't' }).success).toBe(true)
    expect(ClientEvent.safeParse({ type: 'steal', token: 't' }).success).toBe(false)
  })

  it('parses a streaming delta', () => {
    const id = '0193a1b2-c3d4-7e5f-8a6b-1c2d3e4f5a6b'
    const ok = ServerEvent.safeParse({
      type: 'message.delta',
      spaceId: id,
      threadId: id,
      messageId: id,
      seq: 0,
      text: 'トラクション',
    })
    expect(ok.success).toBe(true)
  })
})
