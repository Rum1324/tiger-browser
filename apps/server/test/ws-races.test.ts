import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RealtimeHub, type SocketLike } from '../src/realtime/hub'
import { subscribeMember } from '../src/realtime/ws'
import { spaceWithMembers } from './helpers/fixtures'
import { connectAs, type Harness, startHarness } from './helpers/harness'

const silentLog = { warn() {}, error() {}, info() {}, debug() {} } as never

class FakeSocket implements SocketLike {
  readyState = 1
  bufferedAmount = 0
  sent: string[] = []
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 3
  }
  terminate() {
    this.readyState = 3
  }
}

const SPACE = '0190f000-0000-7000-8000-000000000001'
const USER = '0190f000-0000-7000-8000-0000000000aa'

describe('subscribe racing a member removal', () => {
  it('a removal that lands while the membership query runs leaves the socket unsubscribed', async () => {
    const hub = new RealtimeHub(silentLog)
    const socket = new FakeSocket()
    const client = hub.add(socket, USER, 'session')
    // The query saw the membership (it ran before the removal committed); the removal then
    // committed and dropped the user's sockets before the query's result came back.
    const lookup = async () => {
      hub.dropMembership(SPACE, USER)
      return [SPACE]
    }
    await subscribeMember(hub, client, [SPACE], lookup)
    expect(client.spaces.has(SPACE)).toBe(false)
    hub.publishToSpace(SPACE, { type: 'member.removed', spaceId: SPACE, userId: USER })
    expect(socket.sent.some((s) => s.includes('member.removed'))).toBe(false)
  })

  it('an ordinary subscribe still subscribes', async () => {
    const hub = new RealtimeHub(silentLog)
    const client = hub.add(new FakeSocket(), USER, 'session')
    await subscribeMember(hub, client, [SPACE], async () => [SPACE])
    expect(client.spaces.has(SPACE)).toBe(true)
  })
})

let h: Harness
beforeAll(async () => {
  h = await startHarness({ env: { WS_HEARTBEAT_MS: '100' } })
})
afterAll(() => h.close())

describe('socket session lifetime', () => {
  it('closes an open socket once its session expires or is deleted', async () => {
    const port = await h.listen()
    const { member, space } = await spaceWithMembers(h, 'Expire')
    const ws = await connectAs(port, member.token, [space.id])
    await h.sql`update sessions set expires_at = now() - interval '1 second' where user_id = ${member.user.id}`
    const closed = await Promise.race([
      ws.closed,
      new Promise<null>((r) => setTimeout(() => r(null), 2000)),
    ])
    expect(closed?.code).toBe(4401)
  })
})
