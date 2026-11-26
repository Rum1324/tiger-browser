import type { ServerEvent } from '@tiger/shared'
import { describe, expect, it } from 'vitest'
import { MAX_BUFFERED_BYTES, RealtimeHub, type SocketLike } from '../src/realtime/hub'

const silentLog = { warn() {}, error() {}, info() {}, debug() {} } as never

class FakeSocket implements SocketLike {
  readyState = 1
  bufferedAmount = 0
  sent: string[] = []
  terminated = false
  closed: number | null = null
  failSend = false
  send(data: string) {
    if (this.failSend) throw new Error('EPIPE')
    this.sent.push(data)
  }
  close(code?: number) {
    this.closed = code ?? 1000
    this.readyState = 3
  }
  terminate() {
    this.terminated = true
    this.readyState = 3
  }
}

const SPACE = '0190f000-0000-7000-8000-000000000001'
const event: ServerEvent = {
  type: 'member.removed',
  spaceId: SPACE,
  userId: '0190f000-0000-7000-8000-0000000000ff',
}

describe('RealtimeHub', () => {
  it('cuts off a socket that is not keeping up without affecting the others', () => {
    const hub = new RealtimeHub(silentLog)
    const slow = new FakeSocket()
    slow.bufferedAmount = MAX_BUFFERED_BYTES + 1
    const broken = new FakeSocket()
    broken.failSend = true
    const healthy = new FakeSocket()
    for (const [s, u] of [
      [slow, 'a'],
      [broken, 'b'],
      [healthy, 'c'],
    ] as const)
      hub.subscribe(hub.add(s, u, u), SPACE)

    hub.publishToSpace(SPACE, event)
    expect(slow.terminated).toBe(true)
    expect(slow.sent).toEqual([])
    expect(broken.terminated).toBe(true)
    expect(healthy.sent).toEqual([JSON.stringify(event)])
    expect(hub.clientCount).toBe(1)

    hub.publishToSpace(SPACE, event)
    expect(healthy.sent).toHaveLength(2)
  })

  it('drops sockets that are already closed', () => {
    const hub = new RealtimeHub(silentLog)
    const gone = new FakeSocket()
    gone.readyState = 3
    hub.subscribe(hub.add(gone, 'a', 'a'), SPACE)
    hub.publishToSpace(SPACE, event)
    expect(gone.sent).toEqual([])
    expect(hub.clientCount).toBe(0)
  })

  it('routes private-thread events to the owner only and space-thread events to everyone', () => {
    const hub = new RealtimeHub(silentLog)
    const owner = new FakeSocket()
    const ownerSecondDevice = new FakeSocket()
    const other = new FakeSocket()
    hub.subscribe(hub.add(owner, 'owner', 's1'), SPACE)
    hub.subscribe(hub.add(ownerSecondDevice, 'owner', 's2'), SPACE)
    hub.subscribe(hub.add(other, 'other', 's3'), SPACE)
    hub.publishForThread({ spaceId: SPACE, visibility: 'private', ownerId: 'owner' }, event)
    expect([owner.sent.length, ownerSecondDevice.sent.length, other.sent.length]).toEqual([1, 1, 0])
    hub.publishForThread({ spaceId: SPACE, visibility: 'space', ownerId: 'owner' }, event)
    expect([owner.sent.length, ownerSecondDevice.sent.length, other.sent.length]).toEqual([2, 2, 1])
  })

  it('closes only the sockets of an ended session', () => {
    const hub = new RealtimeHub(silentLog)
    const a = new FakeSocket()
    const b = new FakeSocket()
    hub.add(a, 'u', 'session-a')
    hub.add(b, 'u', 'session-b')
    hub.closeSession('session-a')
    expect(a.closed).toBe(4401)
    expect(b.closed).toBeNull()
    expect(hub.clientCount).toBe(1)
  })
})
