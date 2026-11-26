import { createTigerClient, type TigerClient, type WebSocketCtor } from '../../src'
import { FakeBridge } from './fake-bridge'

export interface RecordedRequest {
  method: string
  path: string
  body: unknown
}

export interface TestClient {
  client: TigerClient
  bridge: FakeBridge
  requests: RecordedRequest[]
  /** Requests whose path matches, e.g. `count('POST', /\/items$/)`. */
  count(method: string, path: RegExp): number
  /** Reconnection gate: while closed, new sockets go to a dead port and fail. */
  gate: { blocked: boolean }
}

/** A client with a fake engine and a fetch that records every request before sending it. */
export function makeClient(serverUrl: string, bridge = new FakeBridge()): TestClient {
  const requests: RecordedRequest[] = []
  const gate = { blocked: false }
  const Native = globalThis.WebSocket as unknown as new (url: string) => WebSocket
  class GatedWebSocket extends Native {
    constructor(url: string) {
      super(gate.blocked ? 'ws://127.0.0.1:9/v1/ws' : url)
    }
  }
  const client = createTigerClient({
    serverUrl,
    bridge,
    WebSocket: GatedWebSocket as unknown as WebSocketCtor,
    realtime: { baseBackoffMs: 40, maxBackoffMs: 200 },
    lookupBatchMs: 5,
    fetch: async (input, init) => {
      const url = new URL(input)
      requests.push({
        method: init.method ?? 'GET',
        path: url.pathname,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      })
      return fetch(input, init)
    },
  })
  return {
    client,
    bridge,
    requests,
    gate,
    count: (method, path) =>
      requests.filter((r) => r.method === method && path.test(r.path)).length,
  }
}

/** Poll until `check` returns a truthy value (or stops throwing). */
export async function waitFor<T>(
  check: () => T,
  timeoutMs = 5000,
  label = 'condition',
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = null
  for (;;) {
    try {
      const v = check()
      if (v) return v as NonNullable<T>
    } catch (e) {
      lastError = e
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}${lastError ? `: ${String(lastError)}` : ''}`)
    }
    await new Promise((r) => setTimeout(r, 10))
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
