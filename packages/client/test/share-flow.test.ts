import { randomUUID } from 'node:crypto'
import type { ShareItemResult } from '@tiger/shared'
import { describe, expect, it } from 'vitest'
import type { ApiClient } from '../src'
import type { ClientContext } from '../src/load'
import { createShareFlow } from '../src/stores/share'
import { FakeBridge, makePage } from './helpers/fake-bridge'

/** The share flow against a server whose answer the test releases. */
function setup() {
  const bridge = new FakeBridge()
  const page = makePage('https://example.com/a', '# A\n\nBody')
  bridge.captures.set('t1', { ok: true, page })
  const requests: { resolve: (r: ShareItemResult) => void }[] = []
  const api: ApiClient = {
    serverUrl: 'http://x.test',
    call: (() =>
      new Promise<ShareItemResult>((resolve) => {
        requests.push({ resolve })
      })) as unknown as ApiClient['call'],
  }
  const ctx: ClientContext = { api, bridge, userId: () => 'u1' }
  const landed: ShareItemResult[] = []
  const flow = createShareFlow(ctx, {
    currentSpaceId: () => randomUUID(),
    findItem: () => null,
    shared: (r) => landed.push(r),
  })
  const result = { outcome: 'created', item: { id: randomUUID() } } as unknown as ShareItemResult
  return { flow, requests, landed, result }
}

describe('share flow: cancelling', () => {
  it('cannot hide a share that is already being sent: the outcome is still shown', async () => {
    const s = setup()
    await s.flow.begin('t1')
    expect(s.flow.store.getState().phase).toBe('preview')
    const confirming = s.flow.confirm()
    expect(s.flow.store.getState().phase).toBe('sending')
    s.flow.cancel() // Esc or a Cancel button while the request is in flight
    expect(s.flow.store.getState().phase).toBe('sending')
    s.requests[0]?.resolve(s.result)
    expect(await confirming).toBe(true)
    expect(s.landed).toHaveLength(1)
    expect(s.flow.store.getState()).toMatchObject({ phase: 'done', outcome: 'created' })
  })

  it('reset (sign-out) clears the flow even while sending', async () => {
    const s = setup()
    await s.flow.begin('t1')
    const confirming = s.flow.confirm()
    s.flow.reset()
    expect(s.flow.store.getState().phase).toBe('idle')
    s.requests[0]?.resolve(s.result)
    await confirming
    expect(s.flow.store.getState().phase).toBe('idle')
  })
})
