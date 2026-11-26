import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spaceWithMembers } from './helpers/fixtures'
import { type Harness, page, startHarness } from './helpers/harness'

let h: Harness
beforeAll(async () => {
  h = await startHarness()
})
afterAll(() => h.close())

describe('threads', () => {
  it('shows private threads to their owner only and Space threads to all members', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'Vis')
    const priv = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'private', title: 'Mine' } },
      owner.token,
    )
    const pub = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      member.token,
    )
    expect(priv).toMatchObject({
      visibility: 'private',
      owner: { id: owner.user.id },
      title: 'Mine',
      lastMessageAt: null,
    })
    const ownerSees = await h.ok(
      'listThreads',
      { params: { spaceId: space.id }, query: {} },
      owner.token,
    )
    expect(ownerSees.map((t) => t.id).sort()).toEqual([priv.id, pub.id].sort())
    const onlyPrivate = await h.ok(
      'listThreads',
      { params: { spaceId: space.id }, query: { visibility: 'private' } },
      owner.token,
    )
    expect(onlyPrivate.map((t) => t.id)).toEqual([priv.id])
    const memberSees = await h.ok(
      'listThreads',
      { params: { spaceId: space.id }, query: {} },
      member.token,
    )
    expect(memberSees.map((t) => t.id)).toEqual([pub.id])
    await h.fails(
      'listMessages',
      { params: { threadId: priv.id }, query: {} },
      member.token,
      404,
      'thread_not_found',
    )
  })

  it('stores messages, names an untitled thread after its first message, and pages backwards', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'Msgs')
    const t = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      owner.token,
    )
    const posted = []
    for (let i = 1; i <= 5; i++) {
      const r = await h.ok(
        'postMessage',
        { params: { threadId: t.id }, body: { content: `message ${i}`, askAi: false } },
        i % 2 ? owner.token : member.token,
      )
      expect(r.assistantMessage).toBeNull()
      posted.push(r.message)
    }
    expect(posted[1]).toMatchObject({
      role: 'user',
      author: { id: member.user.id },
      status: 'complete',
      citations: [],
      attachments: [],
      model: null,
    })
    const all = await h.ok('listMessages', { params: { threadId: t.id }, query: {} }, member.token)
    expect(all.map((m) => m.content)).toEqual(posted.map((m) => m.content))
    const page1 = await h.ok(
      'listMessages',
      { params: { threadId: t.id }, query: { limit: 2 } },
      member.token,
    )
    expect(page1.map((m) => m.content)).toEqual(['message 4', 'message 5'])
    const page2 = await h.ok(
      'listMessages',
      { params: { threadId: t.id }, query: { limit: 2, before: page1[0]?.id } },
      member.token,
    )
    expect(page2.map((m) => m.content)).toEqual(['message 2', 'message 3'])
    await h.fails(
      'listMessages',
      { params: { threadId: t.id }, query: { before: 'yesterday' } },
      member.token,
      400,
      'invalid_request',
    )
    const [thread] = await h.ok(
      'listThreads',
      { params: { spaceId: space.id }, query: {} },
      owner.token,
    )
    expect(thread).toMatchObject({ title: 'message 1', lastMessageAt: expect.any(String) })
  })

  it('lets the thread owner or a Space owner delete a Space thread', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'Del')
    const byOwner = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      owner.token,
    )
    await h.fails(
      'deleteThread',
      { params: { threadId: byOwner.id } },
      member.token,
      403,
      'forbidden',
    )
    const byMember = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      member.token,
    )
    await h.ok('deleteThread', { params: { threadId: byMember.id } }, owner.token)
    await h.ok('deleteThread', { params: { threadId: byOwner.id } }, owner.token)
    expect(
      await h.ok('listThreads', { params: { spaceId: space.id }, query: {} }, owner.token),
    ).toEqual([])
  })
})

describe('attachments', () => {
  it('are refused on Space threads', async () => {
    const { owner, space } = await spaceWithMembers(h, 'AttSpace')
    const t = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      owner.token,
    )
    await h.fails(
      'postMessage',
      {
        params: { threadId: t.id },
        body: {
          content: 'look',
          askAi: false,
          attachments: [page('https://example.com/a', 'body')],
        },
      },
      owner.token,
      400,
      'attachments_not_allowed',
    )
    expect(
      await h.ok('listMessages', { params: { threadId: t.id }, query: {} }, owner.token),
    ).toEqual([])
  })

  it('are refused for blocked pages even on private threads', async () => {
    const { owner, space } = await spaceWithMembers(h, 'AttBlock')
    const t = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'private' } },
      owner.token,
    )
    await h.fails(
      'postMessage',
      {
        params: { threadId: t.id },
        body: {
          content: 'look',
          askAi: false,
          attachments: [page('https://mail.google.com/mail/u/0', 'mail')],
        },
      },
      owner.token,
      422,
      'capture_blocked',
    )
  })

  it('are stored on private threads, echoed as metadata only, and deleted when the thread is shared', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'AttPriv')
    const t = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'private' } },
      owner.token,
    )
    const r = await h.ok(
      'postMessage',
      {
        params: { threadId: t.id },
        body: {
          content: 'summarise',
          askAi: false,
          attachments: [page('https://example.com/a', 'private body', 'Draft')],
        },
      },
      owner.token,
    )
    expect(r.message.attachments).toEqual([
      { url: 'https://example.com/a', title: 'Draft', sourceType: 'web', charCount: 12 },
    ])
    expect(JSON.stringify(r)).not.toContain('private body')
    const [stored] = await h.sql<
      { markdown: string }[]
    >`select markdown from message_attachments where message_id = ${r.message.id}`
    expect(stored?.markdown).toBe('private body')

    await h.fails(
      'shareThread',
      { params: { threadId: t.id } },
      member.token,
      404,
      'thread_not_found',
    )
    const shared = await h.ok('shareThread', { params: { threadId: t.id } }, owner.token)
    expect(shared.visibility).toBe('space')
    const left = await h.sql`
      select 1 from message_attachments a join messages m on m.id = a.message_id where m.thread_id = ${t.id}
    `
    expect(left).toHaveLength(0)
    const seen = await h.ok('listMessages', { params: { threadId: t.id }, query: {} }, member.token)
    expect(seen.map((m) => [m.content, m.attachments])).toEqual([['summarise', []]])
    const audit = await h.ok(
      'listAudit',
      { params: { spaceId: space.id }, query: {} },
      member.token,
    )
    expect(audit[0]).toMatchObject({
      action: 'thread.shared',
      target: { type: 'thread', id: t.id },
    })
    // Now a Space thread: attachments are refused from here on.
    await h.fails(
      'postMessage',
      {
        params: { threadId: t.id },
        body: { content: 'again', askAi: false, attachments: [page('https://example.com/b', 'b')] },
      },
      owner.token,
      400,
      'attachments_not_allowed',
    )
  })
})

describe('exports', () => {
  it('records an export in the audit log, and only for messages the member can read', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'Exp')
    const priv = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'private' } },
      owner.token,
    )
    const { message } = await h.ok(
      'postMessage',
      { params: { threadId: priv.id }, body: { content: 'x', askAi: false } },
      owner.token,
    )
    const body = {
      messageId: message.id,
      title: 'Plan',
      url: 'https://docs.google.com/document/d/abc',
    }
    await h.fails(
      'recordExport',
      { params: { spaceId: space.id }, body },
      member.token,
      404,
      'not_found',
    )
    await h.ok('recordExport', { params: { spaceId: space.id }, body }, owner.token)
    const [event] = await h.ok(
      'listAudit',
      { params: { spaceId: space.id }, query: { limit: 1 } },
      owner.token,
    )
    // A private thread's export is recorded without its title or Doc URL (every member reads the log).
    expect(event).toMatchObject({
      action: 'export.google_doc',
      target: { type: 'export', id: message.id, title: null, url: null },
    })
    const shared = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      owner.token,
    )
    const { message: spaceMessage } = await h.ok(
      'postMessage',
      { params: { threadId: shared.id }, body: { content: 'y', askAi: false } },
      owner.token,
    )
    await h.ok(
      'recordExport',
      { params: { spaceId: space.id }, body: { ...body, messageId: spaceMessage.id } },
      owner.token,
    )
    const [spaceEvent] = await h.ok(
      'listAudit',
      { params: { spaceId: space.id }, query: { limit: 1 } },
      member.token,
    )
    expect(spaceEvent).toMatchObject({
      action: 'export.google_doc',
      target: { type: 'export', id: spaceMessage.id, title: 'Plan', url: body.url },
    })
  })
})
