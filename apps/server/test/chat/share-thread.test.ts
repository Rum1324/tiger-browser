import type { Message } from '@tiger/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newId } from '../../src/ids'
import { planThreadShare, type ShareCandidate } from '../../src/services/threads'
import { spaceWithMembers } from '../helpers/fixtures'
import { connectAs, page } from '../helpers/harness'
import { ask, type ChatHarness, reply, shareSettled, startChatHarness } from './helpers'

const OFFER_SECRET = 'ZEBRA-7731 salary band is 9.5M yen'
const OFFER = page(
  'https://private.example/hr/offer-letter',
  `# Offer\n\n${OFFER_SECRET}.`,
  'Offer letter for Ken',
)
const DECK_BODY = 'PELICAN-4410 internal deck body'
const DECK = page('https://private.example/decks/q3', `# Deck\n\n${DECK_BODY}.`, 'Q3 board deck')

describe('planThreadShare', () => {
  const m = (id: string, role: 'user' | 'assistant', attached = false): ShareCandidate => ({
    id,
    role,
    status: 'complete',
    attached,
  })
  const thread = [
    m('q1', 'user'),
    m('a1', 'assistant'),
    m('q2', 'user', true),
    m('a2', 'assistant'),
    m('a2b', 'assistant'),
    m('q3', 'user'),
    m('a3', 'assistant'),
  ]
  const ids = (xs: ShareCandidate[]) => xs.map((x) => x.id)
  const code = (f: () => unknown) => {
    try {
      f()
    } catch (e) {
      return (e as { code: string }).code
    }
    return null
  }

  it('excludes an attached question with all its answers, and keeps order', () => {
    expect(ids(planThreadShare(thread, [], ['q2']))).toEqual(['q1', 'a1', 'q3', 'a3'])
    expect(ids(planThreadShare(thread, ['q2'], []))).toEqual(ids(thread))
  })

  it('excludes a plain question with its answers, or a single answer', () => {
    expect(ids(planThreadShare(thread, ['q2'], ['q1']))).toEqual(['q2', 'a2', 'a2b', 'q3', 'a3'])
    expect(ids(planThreadShare(thread, ['q2'], ['a2b']))).toEqual([
      'q1',
      'a1',
      'q2',
      'a2',
      'q3',
      'a3',
    ])
  })

  it('refuses undecided, unknown, doubled, misfiled, empty and streaming requests', () => {
    expect(code(() => planThreadShare(thread, [], []))).toBe('thread_has_private_attachments')
    expect(code(() => planThreadShare(thread, ['q2'], ['nope']))).toBe('invalid_request')
    expect(code(() => planThreadShare(thread, ['q2'], ['q2']))).toBe('invalid_request')
    expect(code(() => planThreadShare(thread, ['q2', 'q2'], []))).toBe('invalid_request')
    expect(code(() => planThreadShare(thread, ['q2', 'q1'], []))).toBe('invalid_request')
    expect(code(() => planThreadShare(thread, [], ['q1', 'q2', 'q3']))).toBe('invalid_request')
    const streaming = [...thread.slice(0, 6), { ...m('a3', 'assistant'), status: 'streaming' as const }]
    expect(code(() => planThreadShare(streaming, ['q2'], []))).toBe('invalid_request')
    expect(ids(planThreadShare(streaming, ['q2'], ['a3']))).toEqual(ids(thread.slice(0, 6)))
  })
})

describe('sharing a private thread to the Space', () => {
  let c: ChatHarness
  beforeAll(async () => {
    c = await startChatHarness()
  })
  afterAll(async () => {
    await c.h.close()
  })

  /** Everything stored about a thread: its row, its messages and their attachments, page content included. */
  async function snapshot(threadId: string) {
    const { h } = c
    return {
      thread: await h.sql`select * from threads where id = ${threadId}`,
      messages: await h.sql`select * from messages where thread_id = ${threadId} order by created_at, id`,
      attachments: await h.sql`
        select a.* from message_attachments a join messages m on m.id = a.message_id
        where m.thread_id = ${threadId} order by a.id
      `,
    }
  }

  it('copies only the chosen exchanges, and nothing private reaches another member', async () => {
    const { h, provider } = c
    const { owner, member, space } = await spaceWithMembers(h, 'ShareThread')
    await shareSettled(
      h,
      owner.token,
      space.id,
      'https://example.com/roadmap',
      'Roadmap',
      'The roadmap is public to the team.',
    )
    const port = await h.listen()
    const memberWs = await connectAs(port, member.token, [space.id])

    const priv = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'private' } },
      owner.token,
    )
    provider.script = (req) => {
      const last = req.messages.at(-1)?.content ?? ''
      if (last.includes('roadmap')) return reply('The roadmap is shared [1].')
      if (last.includes('my offer')) return reply(`Your page says ${OFFER_SECRET} [A1].`)
      if (last.includes('the deck')) return reply('The deck covers the quarter [A1].')
      if (last.includes('Next steps')) return reply('Plan the launch.')
      return null
    }
    const q1 = await ask(h, owner.token, priv.id, 'What is on the roadmap?')
    const q2 = await ask(h, owner.token, priv.id, 'What does my offer say?', {
      attachments: [OFFER],
    })
    const q3 = await ask(h, owner.token, priv.id, 'Next steps?')
    const q4 = await ask(h, owner.token, priv.id, 'Summarise the deck', { attachments: [DECK] })
    provider.script = null
    expect(q1.answer.citations.map((x) => x.n)).toEqual([1])

    const ownerBefore = await h.ok('listMessages', { params: { threadId: priv.id } }, owner.token)
    const storedBefore = await snapshot(priv.id)
    const privTitle = (
      await h.ok('listThreads', { params: { spaceId: space.id }, query: {} }, owner.token)
    ).find((t) => t.id === priv.id)?.title
    await memberWs.sync()
    const framesBefore = memberWs.events.length

    const copy = await h.ok(
      'shareThread',
      {
        params: { threadId: priv.id },
        body: {
          includeAttachedMessageIds: [q4.posted.message.id],
          excludeMessageIds: [q2.posted.message.id],
        },
      },
      owner.token,
    )
    expect(copy).toMatchObject({
      spaceId: space.id,
      visibility: 'space',
      owner: { id: owner.user.id },
      // The first question had no page, so the private title carries over.
      title: privTitle,
    })
    expect(copy.id).not.toBe(priv.id)

    // The private thread, its attachments and their content are exactly as they were.
    expect(await snapshot(priv.id)).toEqual(storedBefore)
    expect(await h.ok('listMessages', { params: { threadId: priv.id } }, owner.token)).toEqual(
      ownerBefore,
    )

    // The copy: the chosen messages in order, with their times, authors, models and citations.
    const seen = await h.ok('listMessages', { params: { threadId: copy.id } }, member.token)
    const kept = [q1, q3, q4].flatMap((q) => [
      ownerBefore.find((x) => x.id === q.posted.message.id) as Message,
      ownerBefore.find((x) => x.id === q.answer.id) as Message,
    ])
    expect(seen.map(({ id: _id, threadId: _t, attachments: _a, ...rest }) => rest)).toEqual(
      kept.map(({ id: _id, threadId: _t, attachments: _a, ...rest }) => rest),
    )
    expect(seen.every((x) => x.threadId === copy.id && x.attachments.length === 0)).toBe(true)
    expect(seen.map((x) => x.id)).not.toEqual(expect.arrayContaining([kept[0]?.id]))
    const [pages] = await h.sql<{ n: number }[]>`
      select count(*)::int as n from message_attachments a join messages m on m.id = a.message_id
      where m.thread_id = ${copy.id}
    `
    expect(pages?.n).toBe(0)

    // One announcement: the new thread and its audit line, no per-message frames.
    const created = await memberWs.next('thread.created', (e) => e.thread.id === copy.id)
    expect(created.thread).toEqual(copy)
    const audited = await memberWs.next('audit.appended')
    expect(audited.event).toMatchObject({
      action: 'thread.shared',
      actor: { id: owner.user.id },
      target: { type: 'thread', id: copy.id, url: null },
    })
    await memberWs.sync()
    const newFrames = memberWs.events.slice(framesBefore)
    expect(newFrames.map((e) => e.type)).toEqual(['pong', 'thread.created', 'audit.appended', 'pong'])

    // No route and no frame gives the member the excluded exchange, a page, its title or its URL.
    const memberReads = JSON.stringify([
      seen,
      await h.ok('listThreads', { params: { spaceId: space.id }, query: {} }, member.token),
      await h.ok('listAudit', { params: { spaceId: space.id }, query: {} }, member.token),
      await h.ok('getSpace', { params: { spaceId: space.id } }, member.token),
      await h.ok('listItems', { params: { spaceId: space.id } }, member.token),
      await h.ok('search', { params: { spaceId: space.id }, body: { query: 'ZEBRA' } }, member.token),
      await h.ok('search', { params: { spaceId: space.id }, body: { query: 'PELICAN' } }, member.token),
      memberWs.events,
    ])
    for (const s of [
      'ZEBRA-7731',
      'my offer',
      q2.posted.message.id,
      q2.answer.id,
      'private.example',
      OFFER.title,
      DECK.title,
      DECK_BODY,
      'PELICAN',
      priv.id,
    ]) {
      expect(memberReads).not.toContain(s)
    }
    await h.fails(
      'listMessages',
      { params: { threadId: priv.id } },
      member.token,
      404,
      'thread_not_found',
    )
    memberWs.close()
  })

  it('names the copy after what it shares when the first question had a page', async () => {
    const { h } = c
    const { owner, space } = await spaceWithMembers(h, 'ShareTitle')
    const priv = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'private', title: 'Offer for Ken' } },
      owner.token,
    )
    const post = async (content: string, attached: boolean) =>
      (
        await h.ok(
          'postMessage',
          {
            params: { threadId: priv.id },
            body: { content, askAi: false, ...(attached ? { attachments: [OFFER] } : {}) },
          },
          owner.token,
        )
      ).message
    const first = await post('Read  my   offer', true)
    await post('Plain follow-up question', false)
    const share = (include: string[], exclude: string[]) =>
      h.ok(
        'shareThread',
        {
          params: { threadId: priv.id },
          body: { includeAttachedMessageIds: include, excludeMessageIds: exclude },
        },
        owner.token,
      )
    expect((await share([], [first.id])).title).toBe('Plain follow-up question')
    expect((await share([first.id], [])).title).toBe('Read my offer')

    // Only an assistant message after an excluded attached question would remain: refused, as empty.
    const alone = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'private', title: 'Secret topic' } },
      owner.token,
    )
    const { message } = await h.ok(
      'postMessage',
      { params: { threadId: alone.id }, body: { content: 'x', askAi: false, attachments: [OFFER] } },
      owner.token,
    )
    await h.fails(
      'shareThread',
      {
        params: { threadId: alone.id },
        body: { includeAttachedMessageIds: [], excludeMessageIds: [message.id] },
      },
      owner.token,
      400,
      'invalid_request',
    )
  })

  it('refuses bad requests and changes nothing', async () => {
    const { h } = c
    const { owner, member, space } = await spaceWithMembers(h, 'ShareRefuse')
    const priv = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'private' } },
      owner.token,
    )
    const plain = (
      await h.ok(
        'postMessage',
        { params: { threadId: priv.id }, body: { content: 'plain', askAi: false } },
        owner.token,
      )
    ).message
    const attached = (
      await h.ok(
        'postMessage',
        { params: { threadId: priv.id }, body: { content: 'q', askAi: false, attachments: [OFFER] } },
        owner.token,
      )
    ).message
    const other = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'private' } },
      owner.token,
    )
    const otherMessage = (
      await h.ok(
        'postMessage',
        { params: { threadId: other.id }, body: { content: 'elsewhere', askAi: false } },
        owner.token,
      )
    ).message
    const spaceThread = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      owner.token,
    )

    const state = async () => ({
      threads: await h.sql`select id, visibility, title from threads where space_id = ${space.id} order by id`,
      messages: await h.sql`
        select m.id from messages m join threads t on t.id = m.thread_id
        where t.space_id = ${space.id} order by m.id
      `,
      audit: await h.ok('listAudit', { params: { spaceId: space.id }, query: {} }, owner.token),
      priv: await snapshot(priv.id),
    })
    const before = await state()
    const refuse = async (
      threadId: string,
      include: string[],
      exclude: string[],
      token: string,
      status: number,
      code: string,
    ) =>
      h.fails(
        'shareThread',
        {
          params: { threadId },
          body: { includeAttachedMessageIds: include, excludeMessageIds: exclude },
        },
        token,
        status,
        code,
      )

    await refuse(priv.id, [], [], owner.token, 409, 'thread_has_private_attachments')
    await refuse(priv.id, [], [plain.id], owner.token, 409, 'thread_has_private_attachments')
    await refuse(priv.id, [attached.id], [otherMessage.id], owner.token, 400, 'invalid_request')
    await refuse(priv.id, [attached.id], [newId()], owner.token, 400, 'invalid_request')
    await refuse(priv.id, [attached.id], [attached.id], owner.token, 400, 'invalid_request')
    await refuse(priv.id, [attached.id, plain.id], [], owner.token, 400, 'invalid_request')
    await refuse(priv.id, [], [plain.id, attached.id], owner.token, 400, 'invalid_request')
    await refuse(priv.id, [attached.id], [], member.token, 404, 'thread_not_found')
    await refuse(spaceThread.id, [], [], owner.token, 409, 'already_shared')
    await refuse(spaceThread.id, [], [], member.token, 403, 'forbidden')

    // An answer still being written cannot be copied (it has no final text yet).
    const streamingId = newId()
    await h.sql`
      insert into messages (id, thread_id, role, author_id, content, status)
      values (${streamingId}, ${priv.id}, 'assistant', ${owner.user.id}, '', 'streaming')
    `
    await refuse(priv.id, [attached.id], [], owner.token, 400, 'invalid_request')
    await h.sql`delete from messages where id = ${streamingId}`

    expect(await state()).toEqual(before)
  })
})
