import type { Citation } from '@tiger/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { previewCitations } from '../src/chat'
import { newId } from '../src/ids'
import { createContextBuilder } from '../src/retrieval'
import { settleCitations } from '../src/services/answers'
import { spaceWithMembers } from './helpers/fixtures'
import { type Harness, page, startHarness } from './helpers/harness'

let h: Harness
beforeAll(async () => {
  h = await startHarness()
})
afterAll(() => h.close())

/** Shares the same URL twice with different text: one item with versions 1 and 2. */
async function twoVersions(token: string, spaceId: string, url: string) {
  const v1 = await h.ok(
    'shareItem',
    { params: { spaceId }, body: { page: page(url, '# First', 'Doc') } },
    token,
  )
  const v2 = await h.ok(
    'shareItem',
    { params: { spaceId }, body: { page: page(url, '# Second', 'Doc') } },
    token,
  )
  await h.settle()
  return { item: v2.item, v1: v1.item.currentVersion, v2: v2.item.currentVersion }
}

/** A citation as code before Citation.versionNumber wrote it. */
function legacy(
  n: number,
  item: {
    id: string
    title: string
    url: string
    sharedBy: Citation['sharedBy']
    sharedAt: string
  },
  versionId: string,
): Omit<Citation, 'available' | 'versionNumber'> {
  return {
    n,
    itemId: item.id,
    itemVersionId: versionId,
    title: item.title,
    url: item.url,
    sourceType: 'web',
    sharedBy: item.sharedBy,
    sharedAt: item.sharedAt,
    quote: 'q',
  }
}

describe('Citation.versionNumber', () => {
  it('reads stored citations written without it from their item version', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'CvLegacy')
    const { item, v1, v2 } = await twoVersions(owner.token, space.id, 'https://example.com/cv')
    const gone = await h.ok(
      'shareItem',
      { params: { spaceId: space.id }, body: { page: page('https://example.com/gone', 'x') } },
      owner.token,
    )
    await h.settle()
    const thread = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      owner.token,
    )
    await h.sql`
      insert into messages (id, thread_id, role, author_id, content, citations, status)
      values (${newId()}, ${thread.id}, 'assistant', ${owner.user.id}, 'a [1] b [2] c [3]',
              ${h.sql.json([
                legacy(1, item, v1.id),
                legacy(2, item, v2.id),
                legacy(3, gone.item, gone.item.currentVersion.id),
              ])}, 'complete')
    `
    await h.ok('unshareItem', { params: { itemId: gone.item.id } }, owner.token)

    const [msg] = await h.ok(
      'listMessages',
      { params: { threadId: thread.id }, query: {} },
      member.token,
    )
    expect(msg?.citations.map((c) => [c.n, c.versionNumber, c.available])).toEqual([
      [1, 1, true],
      [2, 2, true],
      // The unshared item's versions are gone; its chip is unavailable and shows no version.
      [3, 1, false],
    ])
  })

  it('keeps legacy citations when a private thread is shared to the Space', async () => {
    const { owner, space } = await spaceWithMembers(h, 'CvShare')
    const { item, v1 } = await twoVersions(owner.token, space.id, 'https://example.com/cvs')
    const thread = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'private' } },
      owner.token,
    )
    await h.sql`
      insert into messages (id, thread_id, role, author_id, content, citations, status)
      values (${newId()}, ${thread.id}, 'assistant', ${owner.user.id}, 'see [1]',
              ${h.sql.json([legacy(1, item, v1.id)])}, 'complete')
    `
    const shared = await h.ok(
      'shareThread',
      {
        params: { threadId: thread.id },
        body: { includeAttachedMessageIds: [], excludeMessageIds: [] },
      },
      owner.token,
    )
    const [msg] = await h.ok(
      'listMessages',
      { params: { threadId: shared.id }, query: {} },
      owner.token,
    )
    expect(msg?.citations.map((c) => [c.itemVersionId, c.versionNumber])).toEqual([[v1.id, 1]])
  })

  it('takes the number from the database, not from the Answerer, and drops a borrowed version', async () => {
    const { owner, space } = await spaceWithMembers(h, 'CvSettle')
    const { item, v1, v2 } = await twoVersions(owner.token, space.id, 'https://example.com/cvx')
    const other = await h.ok(
      'shareItem',
      { params: { spaceId: space.id }, body: { page: page('https://example.com/o', 'o') } },
      owner.token,
    )
    const { stored } = await settleCitations(h.sql, space.id, [
      { ...legacy(1, item, v1.id), versionNumber: 99 },
      { ...legacy(2, item, v2.id) },
      // Names this item but another item's version.
      { ...legacy(3, item, other.item.currentVersion.id), versionNumber: 1 },
    ])
    expect(stored.map((c) => [c.n, c.versionNumber])).toEqual([
      [1, 1],
      [2, 2],
    ])
  })

  it('is carried by context sources into the citations an answer produces', async () => {
    const { owner, space } = await spaceWithMembers(h, 'CvCtx')
    await twoVersions(owner.token, space.id, 'https://example.com/cvc')
    const ctx = await createContextBuilder({
      sql: h.sql,
      retriever: { search: async () => [] },
      options: { wholeSpaceMaxTokens: 10_000 },
    }).build({ spaceId: space.id, question: 'q' })
    expect(ctx.sources.map((s) => s.versionNumber)).toEqual([2])
    expect(previewCitations(ctx.sources).map((c) => c.versionNumber)).toEqual([2])
  })
})
