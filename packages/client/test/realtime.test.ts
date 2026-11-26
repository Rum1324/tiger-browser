import { api } from '@tiger/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type ConnectionState, createApiClient, RealtimeClient } from '../src'
import { sleep, waitFor } from './helpers/client'
import { fakeServer } from './helpers/fake-ws'
import { startServer, type TestServer } from './helpers/server'

const SPACE_1 = '0197a000-0000-7000-8000-0000000000a1'
const SPACE_2 = '0197a000-0000-7000-8000-0000000000a2'

describe('backoff', () => {
  it('doubles per attempt, is capped, and is jittered within [exp/2, exp]', () => {
    const low = new RealtimeClient({
      serverUrl: 'http://x.test',
      getToken: () => 't',
      WebSocket: fakeServer().Ctor,
      baseBackoffMs: 100,
      maxBackoffMs: 1000,
      random: () => 0,
    })
    const high = new RealtimeClient({
      serverUrl: 'http://x.test',
      getToken: () => 't',
      WebSocket: fakeServer().Ctor,
      baseBackoffMs: 100,
      maxBackoffMs: 1000,
      random: () => 1,
    })
    expect([0, 1, 2, 3, 4, 10].map((n) => low.backoffDelay(n))).toEqual([
      50, 100, 200, 400, 500, 500,
    ])
    expect([0, 1, 2, 3, 4, 10].map((n) => high.backoffDelay(n))).toEqual([
      100, 200, 400, 800, 1000, 1000,
    ])
  })
})

describe('protocol with a scripted endpoint', () => {
  it('sends auth first, subscribes after ready, goes online on the subscribed acknowledgement', async () => {
    const fake = fakeServer()
    const states: ConnectionState[] = []
    const rt = new RealtimeClient({
      serverUrl: 'https://api.test',
      getToken: () => 'tok',
      WebSocket: fake.Ctor,
    })
    rt.on('state', (s) => states.push(s))
    rt.setSpaces([SPACE_1])
    rt.start()
    await waitFor(() => rt.state === 'online')
    expect(fake.sockets[0]?.url).toBe('wss://api.test/v1/ws')
    expect(fake.sockets[0]?.sent).toEqual([
      { type: 'auth', token: 'tok' },
      { type: 'subscribe', spaceIds: [SPACE_1] },
    ])
    expect(states).toEqual(['connecting', 'online'])

    // A Space added while online is subscribed at once.
    rt.setSpaces([SPACE_1, SPACE_2])
    expect(fake.sockets[0]?.sent.at(-1)).toEqual({
      type: 'subscribe',
      spaceIds: [SPACE_1, SPACE_2],
    })
    rt.stop()
    expect(rt.state).toBe('offline')
  })

  it('reconnects with backoff after a drop, resubscribes every Space, and emits resync', async () => {
    const fake = fakeServer()
    const rt = new RealtimeClient({
      serverUrl: 'http://api.test',
      getToken: () => 'tok',
      WebSocket: fake.Ctor,
      baseBackoffMs: 20,
    })
    let resyncs = 0
    rt.on('resync', () => resyncs++)
    rt.setSpaces([SPACE_1, SPACE_2])
    rt.start()
    await waitFor(() => rt.state === 'online')
    expect(resyncs).toBe(0)
    fake.sockets[0]?.drop()
    expect(rt.state).toBe('reconnecting')
    await waitFor(() => rt.state === 'online')
    expect(fake.sockets).toHaveLength(2)
    expect(fake.sockets[1]?.sent).toEqual([
      { type: 'auth', token: 'tok' },
      { type: 'subscribe', spaceIds: [SPACE_1, SPACE_2] },
    ])
    expect(resyncs).toBe(1)
    rt.stop()
  })

  it('keeps retrying a refused or silent endpoint with growing delays, then recovers', async () => {
    const fake = fakeServer((i) => (i < 2 ? 'refuse' : i < 4 ? 'silent' : 'normal'))
    const opened: number[] = []
    const rt = new RealtimeClient({
      serverUrl: 'http://api.test',
      getToken: () => 'tok',
      WebSocket: class {
        constructor(url: string) {
          opened.push(Date.now())
          // biome-ignore lint/correctness/noConstructorReturn: delegate to the scripted socket
          return new fake.Ctor(url)
        }
      } as never,
      baseBackoffMs: 20,
      maxBackoffMs: 80,
      handshakeTimeoutMs: 40,
      random: () => 1,
    })
    rt.start()
    await waitFor(() => rt.state === 'online', 5000)
    expect(fake.sockets).toHaveLength(5)
    const gaps = opened.slice(1).map((t, i) => t - (opened[i] as number))
    // Refusals retry after 20 then 40 ms; silent sockets add the 40 ms handshake timeout; capped at 80.
    expect(gaps[0]).toBeGreaterThanOrEqual(18)
    expect(gaps[1]).toBeGreaterThanOrEqual(38)
    expect(gaps[2]).toBeGreaterThanOrEqual(78 + 38)
    expect(gaps[3]).toBeGreaterThanOrEqual(78 + 38)
    rt.stop()
  })

  it('a ping without an answer counts as a dead connection', async () => {
    const fake = fakeServer((i) => (i === 0 ? 'no-pong' : 'normal'))
    const rt = new RealtimeClient({
      serverUrl: 'http://api.test',
      getToken: () => 'tok',
      WebSocket: fake.Ctor,
      heartbeatMs: 30,
      heartbeatTimeoutMs: 30,
      baseBackoffMs: 10,
    })
    let resynced = false
    rt.on('resync', () => {
      resynced = true
    })
    rt.start()
    await waitFor(() => fake.sockets.length === 2 && rt.state === 'online', 3000)
    expect(fake.sockets[0]?.sent.some((f) => f.type === 'ping')).toBe(true)
    expect(fake.sockets[0]?.closedWith).toBe(1000)
    expect(resynced).toBe(true)
    // The healthy socket answers pings and stays.
    await sleep(150)
    expect(fake.sockets).toHaveLength(2)
    rt.stop()
  })

  it('close code 4401 means unauthorized: no retry', async () => {
    const fake = fakeServer()
    const rt = new RealtimeClient({
      serverUrl: 'http://api.test',
      getToken: () => 'tok',
      WebSocket: fake.Ctor,
      baseBackoffMs: 5,
    })
    let unauthorized = 0
    rt.on('unauthorized', () => unauthorized++)
    rt.start()
    await waitFor(() => rt.state === 'online')
    fake.sockets[0]?.drop(4401)
    await sleep(60)
    expect(rt.state).toBe('unauthorized')
    expect(unauthorized).toBe(1)
    expect(fake.sockets).toHaveLength(1)
  })
})

describe('against the real server', () => {
  let server: TestServer
  beforeAll(async () => {
    server = await startServer()
  })
  afterAll(async () => {
    await server.close()
  })

  it('authenticates, subscribes, receives the acknowledgement, heartbeats, and gets Space events', async () => {
    let token: string | null = null
    const http = createApiClient({ serverUrl: server.url, getToken: () => token })
    token = (await http.call(api.authDev, { body: { email: 'rt@example.com', name: 'RT' } })).token
    const space = await http.call(api.createSpace, { body: { name: 'RT' } })

    const rt = new RealtimeClient({ serverUrl: server.url, getToken: () => token, heartbeatMs: 40 })
    const subscribed: string[][] = []
    let pongs = 0
    rt.on('subscribed', (e) => subscribed.push(e.spaceIds))
    rt.on('pong', () => pongs++)
    rt.setSpaces([space.id])
    rt.start()
    await waitFor(() => rt.state === 'online')
    expect(subscribed).toEqual([[space.id]])
    await waitFor(() => pongs >= 2, 3000, 'pongs')

    const renamed: string[] = []
    rt.on('space.updated', (e) => renamed.push(e.name))
    await http.call(api.updateSpace, { params: { spaceId: space.id }, body: { name: 'RT2' } })
    await waitFor(() => renamed.includes('RT2'))

    // A server-side drop is followed by reconnect and resubscribe.
    let resyncs = 0
    rt.on('resync', () => resyncs++)
    server.dropSockets()
    await waitFor(() => resyncs === 1 && rt.state === 'online', 5000, 'resync')
    expect(subscribed).toEqual([[space.id], [space.id]])
    rt.stop()
  })

  it('a token the server rejects ends in unauthorized (4401) without retrying', async () => {
    const rt = new RealtimeClient({
      serverUrl: server.url,
      getToken: () => 'y'.repeat(43),
      baseBackoffMs: 5,
    })
    rt.start()
    await waitFor(() => rt.state === 'unauthorized', 5000)
    await sleep(50)
    expect(rt.state).toBe('unauthorized')
  })
})
