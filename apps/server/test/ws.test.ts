import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spaceWithMembers } from './helpers/fixtures'
import { connectAs, connectWs, type Harness, page, startHarness } from './helpers/harness'

let h: Harness
let port: number
beforeAll(async () => {
  h = await startHarness()
  port = await h.listen()
})
afterAll(() => h.close())

describe('/v1/ws', () => {
  it('requires auth as the first frame', async () => {
    const c = await connectWs(port)
    c.send({ type: 'ping' })
    expect((await c.closed).code).toBe(4401)
  })

  it('closes on an invalid token', async () => {
    const c = await connectWs(port)
    c.send({ type: 'auth', token: 'x'.repeat(43) })
    expect((await c.closed).code).toBe(4401)
  })

  it('answers ping with pong and rejects malformed frames without closing', async () => {
    const { token, user } = await h.login('Pinger')
    const c = await connectWs(port)
    c.send({ type: 'auth', token })
    expect(await c.next('ready')).toEqual({ type: 'ready', userId: user.id })
    c.socket.send('not json')
    expect((await c.next('error')).code).toBe('invalid_frame')
    await c.sync()
    c.close()
  })

  it('subscribes only to Spaces the user belongs to, without saying which ids exist', async () => {
    const mine = await spaceWithMembers(h, 'WsMine')
    const theirs = await spaceWithMembers(h, 'WsTheirs')
    const c = await connectWs(port)
    c.send({ type: 'auth', token: mine.member.token })
    await c.next('ready')
    c.send({ type: 'subscribe', spaceIds: [mine.space.id, theirs.space.id] })
    // The confirmation lists only the Space the user belongs to, then the denial for the rest.
    expect(await c.next('subscribed')).toEqual({ type: 'subscribed', spaceIds: [mine.space.id] })
    expect(await c.next('error')).toMatchObject({
      code: 'subscribe_denied',
      message: '1 Space(s) not found',
    })
    await h.ok(
      'shareItem',
      { params: { spaceId: theirs.space.id }, body: { page: page('https://example.com/t', 't') } },
      theirs.owner.token,
    )
    await h.ok(
      'shareItem',
      { params: { spaceId: mine.space.id }, body: { page: page('https://example.com/m', 'm') } },
      mine.owner.token,
    )
    const up = await c.next('item.upserted')
    expect(up.item.spaceId).toBe(mine.space.id)
    await h.settle()
    await c.sync()
    expect(
      c.events
        .filter((e) => e.type === 'item.upserted')
        .every((e) => e.type === 'item.upserted' && e.item.spaceId === mine.space.id),
    ).toBe(true)
    c.close()
  })

  it('keeps one member’s private-thread events away from another member’s socket', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'WsPriv')
    const ownerWs = await connectAs(port, owner.token, [space.id])
    const memberWs = await connectAs(port, member.token, [space.id])
    const t = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'private' } },
      owner.token,
    )
    await h.ok(
      'postMessage',
      { params: { threadId: t.id }, body: { content: 'secret plan', askAi: false } },
      owner.token,
    )
    await h.ok('deleteThread', { params: { threadId: t.id } }, owner.token)
    expect((await ownerWs.next('thread.created')).thread.id).toBe(t.id)
    expect((await ownerWs.next('message.created')).message.content).toBe('secret plan')
    expect(await ownerWs.next('thread.deleted')).toEqual({
      type: 'thread.deleted',
      spaceId: space.id,
      threadId: t.id,
    })
    await memberWs.sync()
    expect(JSON.stringify(memberWs.events)).not.toContain(t.id)
    expect(memberWs.events.map((e) => e.type)).toEqual(['ready', 'subscribed', 'pong', 'pong'])

    // Once shared, the new Space thread's events reach the member too.
    const t2 = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'private' } },
      owner.token,
    )
    await h.ok(
      'postMessage',
      { params: { threadId: t2.id }, body: { content: 'worth sharing', askAi: false } },
      owner.token,
    )
    const copy = await h.ok(
      'shareThread',
      { params: { threadId: t2.id }, body: { includeAttachedMessageIds: [], excludeMessageIds: [] } },
      owner.token,
    )
    expect((await memberWs.next('thread.created')).thread).toMatchObject({
      id: copy.id,
      visibility: 'space',
    })
    await h.ok(
      'postMessage',
      { params: { threadId: copy.id }, body: { content: 'now public', askAi: false } },
      owner.token,
    )
    expect((await memberWs.next('message.created')).message.content).toBe('now public')
    ownerWs.close()
    memberWs.close()
  })

  it('stops delivering a Space to a removed member, after telling them', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'WsRemove')
    const memberWs = await connectAs(port, member.token, [space.id])
    await h.ok(
      'removeMember',
      { params: { spaceId: space.id, userId: member.user.id } },
      owner.token,
    )
    expect(await memberWs.next('member.removed')).toEqual({
      type: 'member.removed',
      spaceId: space.id,
      userId: member.user.id,
    })
    await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      owner.token,
    )
    await memberWs.sync()
    expect(memberWs.events.some((e) => e.type === 'thread.created')).toBe(false)
    memberWs.close()
  })

  it('tells members, and only members, when a Space is renamed or recoloured', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'WsRename')
    const other = await spaceWithMembers(h, 'WsRenameOther')
    const memberWs = await connectAs(port, member.token, [space.id])
    const outsiderWs = await connectAs(port, other.member.token, [other.space.id])
    await h.ok(
      'updateSpace',
      { params: { spaceId: space.id }, body: { name: 'Renamed', hue: 'violet' } },
      owner.token,
    )
    expect(await memberWs.next('space.updated')).toEqual({
      type: 'space.updated',
      spaceId: space.id,
      name: 'Renamed',
      hue: 'violet',
    })
    await h.ok('updateSpace', { params: { spaceId: space.id }, body: { hue: 'teal' } }, owner.token)
    expect(await memberWs.next('space.updated', (e) => e.hue === 'teal')).toMatchObject({
      name: 'Renamed',
    })
    await outsiderWs.sync()
    expect(JSON.stringify(outsiderWs.events)).not.toContain(space.id)
    memberWs.close()
    outsiderWs.close()
  })

  it('tells members when someone joins', async () => {
    const { owner, space } = await spaceWithMembers(h, 'WsJoin')
    const ownerWs = await connectAs(port, owner.token, [space.id])
    const newcomer = await h.login('Newcomer')
    const { token } = await h.ok(
      'createInvite',
      { params: { spaceId: space.id }, body: {} },
      owner.token,
    )
    await h.ok('acceptInvite', { body: { token } }, newcomer.token)
    expect((await ownerWs.next('member.joined')).user.id).toBe(newcomer.user.id)
    expect(
      (await ownerWs.next('audit.appended', (e) => e.event.action === 'member.joined')).event.actor
        .id,
    ).toBe(newcomer.user.id)
    ownerWs.close()
  })

  it('stops delivering a Space after unsubscribe, keeps the others, and can subscribe again', async () => {
    const a = await spaceWithMembers(h, 'WsUnsubA')
    const owner = a.owner
    const b = await h.ok('createSpace', { body: { name: 'WsUnsubB' } }, owner.token)
    const ws = await connectAs(port, owner.token, [a.space.id, b.id])
    // Unknown ids and repeats are ignored without an error frame.
    ws.send({
      type: 'unsubscribe',
      spaceIds: [a.space.id, a.space.id, '01900000-0000-7000-8000-000000000000'],
    })
    await ws.sync()
    const before = ws.events.length
    await h.ok(
      'updateSpace',
      { params: { spaceId: a.space.id }, body: { name: 'A2' } },
      owner.token,
    )
    await h.ok('updateSpace', { params: { spaceId: b.id }, body: { name: 'B2' } }, owner.token)
    expect((await ws.next('space.updated')).spaceId).toBe(b.id)
    await ws.sync()
    const after = ws.events.slice(before)
    expect(after.some((e) => e.type === 'error')).toBe(false)
    expect(JSON.stringify(after)).not.toContain(a.space.id)

    // Another socket of the same user is unaffected.
    const other = await connectAs(port, owner.token, [a.space.id])
    ws.send({ type: 'unsubscribe', spaceIds: [a.space.id] })
    await ws.sync()
    await h.ok(
      'updateSpace',
      { params: { spaceId: a.space.id }, body: { name: 'A3' } },
      owner.token,
    )
    expect((await other.next('space.updated')).name).toBe('A3')

    ws.send({ type: 'subscribe', spaceIds: [a.space.id] })
    expect(await ws.next('subscribed', (e) => e.spaceIds.length === 1)).toEqual({
      type: 'subscribed',
      spaceIds: [a.space.id],
    })
    await h.ok(
      'updateSpace',
      { params: { spaceId: a.space.id }, body: { name: 'A4' } },
      owner.token,
    )
    expect((await ws.next('space.updated', (e) => e.spaceId === a.space.id)).name).toBe('A4')
    ws.close()
    other.close()
  })

  it('closes sockets of a session that logs out', async () => {
    const { token } = await h.login('Quitter')
    const c = await connectWs(port)
    c.send({ type: 'auth', token })
    await c.next('ready')
    await h.ok('authLogout', {}, token)
    expect((await c.closed).code).toBe(4401)
  })
})
