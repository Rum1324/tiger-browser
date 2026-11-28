import { type Citation, canonicalUrl } from '@tiger/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newId } from '../src/ids'
import type { Indexer, IndexInput } from '../src/seams'
import { insertChunk, spaceWithMembers } from './helpers/fixtures'
import { connectAs, type Harness, page, startHarness } from './helpers/harness'

/** Records calls; a call for a title containing "boom" fails. */
const indexed: IndexInput[] = []
const recordingIndexer: Indexer = {
  async index(input) {
    indexed.push(input)
    if (input.title.includes('boom')) throw new Error('embedding failed')
  },
}

let h: Harness
beforeAll(async () => {
  h = await startHarness({ indexer: recordingIndexer })
})
afterAll(() => h.close())

describe('shareItem', () => {
  it('returns new, then version on changed content, then unchanged on the same hash', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'Share')
    const url = 'https://example.com/post?b=2&a=1'
    const first = await h.ok(
      'shareItem',
      { params: { spaceId: space.id }, body: { page: page(url, '# One') } },
      owner.token,
    )
    expect(first.outcome).toBe('new')
    expect(first.item).toMatchObject({
      url,
      status: 'indexing',
      versionCount: 1,
      sharedBy: { id: owner.user.id },
      currentVersion: { number: 1, charCount: 5, capturedBy: { id: owner.user.id } },
    })
    const [stored] = await h.sql<
      { url_key: string }[]
    >`select url_key from items where id = ${first.item.id}`
    expect(stored?.url_key).toBe('https://example.com/post?a=1&b=2')

    // Same page through a tracking link and a fragment: same item, new version by the other member.
    const changed = await h.ok(
      'shareItem',
      {
        params: { spaceId: space.id },
        body: {
          page: page('https://example.com/post/?a=1&b=2&utm_source=x#top', '# Two', 'New title'),
        },
      },
      member.token,
    )
    expect(changed.outcome).toBe('version')
    expect(changed.item).toMatchObject({
      id: first.item.id,
      title: 'New title',
      versionCount: 2,
      sharedBy: { id: owner.user.id },
      currentVersion: { number: 2, capturedBy: { id: member.user.id } },
    })
    expect(changed.item.currentVersion.contentHash).not.toBe(first.item.currentVersion.contentHash)

    const same = await h.ok(
      'shareItem',
      { params: { spaceId: space.id }, body: { page: page(url, '# Two') } },
      owner.token,
    )
    expect(same.outcome).toBe('unchanged')
    expect(same.item.versionCount).toBe(2)

    await h.settle()
    const detail = await h.ok('getItem', { params: { itemId: first.item.id } }, member.token)
    expect(detail).toMatchObject({
      status: 'ready',
      markdown: '# Two',
      extractor: 'readability@1',
      lang: 'en',
    })
    const versions = await h.ok(
      'listItemVersions',
      { params: { itemId: first.item.id } },
      member.token,
    )
    expect(versions.map((v) => v.number)).toEqual([2, 1])
    expect(
      (await h.ok('listItems', { params: { spaceId: space.id } }, member.token)).map((i) => i.id),
    ).toEqual([first.item.id])
    const audit = await h.ok('listAudit', { params: { spaceId: space.id }, query: {} }, owner.token)
    expect(audit.slice(0, 2).map((a) => a.action)).toEqual(['item.reshared', 'item.shared'])
    // One index run per stored version; unchanged shares do not re-index.
    expect(indexed.filter((i) => i.itemId === first.item.id).map((i) => i.markdown)).toEqual([
      '# One',
      '# Two',
    ])
  })

  it('refuses pages the blocklist forbids, whatever the client says', async () => {
    const { owner, space } = await spaceWithMembers(h, 'Block')
    for (const url of [
      'https://mail.google.com/mail/u/0/#inbox',
      'https://direct.bk.mufg.jp/accounts',
      'https://example.com/login',
      'http://192.168.1.10/admin',
      'https://my.1password.com/vaults',
    ]) {
      await h.fails(
        'shareItem',
        { params: { spaceId: space.id }, body: { page: page(url, 'secret') } },
        owner.token,
        422,
        'capture_blocked',
      )
    }
    expect(await h.ok('listItems', { params: { spaceId: space.id } }, owner.token)).toEqual([])
  })

  it('marks an item failed when indexing fails', async () => {
    const { owner, space } = await spaceWithMembers(h, 'Fail')
    const r = await h.ok(
      'shareItem',
      { params: { spaceId: space.id }, body: { page: page('https://example.com/f', 'x', 'boom') } },
      owner.token,
    )
    await h.settle()
    expect((await h.ok('getItem', { params: { itemId: r.item.id } }, owner.token)).status).toBe(
      'failed',
    )
  })

  it('keeps only the current version chunked once indexing settles', async () => {
    const { owner, space } = await spaceWithMembers(h, 'Chunks')
    const v1 = await h.ok(
      'shareItem',
      { params: { spaceId: space.id }, body: { page: page('https://example.com/c', 'v1') } },
      owner.token,
    )
    await h.settle()
    await insertChunk(h, {
      id: newId(),
      spaceId: space.id,
      itemId: v1.item.id,
      versionId: v1.item.currentVersion.id,
      ord: 0,
      text: 'old',
    })
    const v2 = await h.ok(
      'shareItem',
      { params: { spaceId: space.id }, body: { page: page('https://example.com/c', 'v2') } },
      owner.token,
    )
    await h.settle()
    const rows = await h.sql<
      { item_version_id: string }[]
    >`select item_version_id from chunks where item_id = ${v1.item.id}`
    expect(rows).toEqual([])
    expect((await h.ok('getItem', { params: { itemId: v2.item.id } }, owner.token)).status).toBe(
      'ready',
    )
  })

  it('broadcasts item.upserted for the share and again when indexing settles', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'Events')
    const port = await h.listen()
    const ws = await connectAs(port, member.token, [space.id])
    const r = await h.ok(
      'shareItem',
      { params: { spaceId: space.id }, body: { page: page('https://example.com/e', 'e') } },
      owner.token,
    )
    expect((await ws.next('item.upserted')).item).toMatchObject({
      id: r.item.id,
      status: 'indexing',
    })
    expect((await ws.next('item.upserted')).item).toMatchObject({ id: r.item.id, status: 'ready' })
    expect((await ws.next('audit.appended')).event.action).toBe('item.shared')
    ws.close()
  })
})

describe('listItemIndex', () => {
  it('lists every item of the caller’s Spaces as canonical keys, and nothing of other Spaces', async () => {
    const a = await spaceWithMembers(h, 'IdxA')
    const b = await spaceWithMembers(h, 'IdxB')
    const doc = 'https://docs.google.com/document/d/abc123/edit?tab=t.0'
    const ia = await h.ok(
      'shareItem',
      { params: { spaceId: a.space.id }, body: { page: page(doc, 'a', 'Plan') } },
      a.owner.token,
    )
    // A second version: the index carries the current one.
    await h.ok(
      'shareItem',
      { params: { spaceId: a.space.id }, body: { page: page(doc, 'a2', 'Plan v2') } },
      a.member.token,
    )
    const second = await h.ok(
      'shareItem',
      {
        params: { spaceId: a.space.id },
        body: { page: page('https://example.com/idx?b=2&a=1#top', 'x', 'Other') },
      },
      a.member.token,
    )
    // The same URL in a Space the caller does not belong to.
    const ib = await h.ok(
      'shareItem',
      { params: { spaceId: b.space.id }, body: { page: page(doc, 'b', 'Secret') } },
      b.owner.token,
    )
    await h.settle()

    const index = await h.ok('listItemIndex', {}, a.member.token)
    const current = await h.ok('getItem', { params: { itemId: ia.item.id } }, a.member.token)
    expect(index).toEqual([
      {
        itemId: second.item.id,
        spaceId: a.space.id,
        urlKey: canonicalUrl('https://example.com/idx?b=2&a=1#top'),
        title: 'Other',
        sharedBy: { id: a.member.user.id, name: a.member.user.name, avatarUrl: null },
        versionNumber: 1,
        contentHash: second.item.currentVersion.contentHash,
        updatedAt: second.item.updatedAt,
      },
      {
        itemId: ia.item.id,
        spaceId: a.space.id,
        urlKey: canonicalUrl(doc),
        title: 'Plan v2',
        sharedBy: { id: a.owner.user.id, name: a.owner.user.name, avatarUrl: null },
        versionNumber: 2,
        contentHash: current.currentVersion.contentHash,
        updatedAt: current.updatedAt,
      },
    ])
    // A view of the Space's items also matches by the same key.
    expect(canonicalUrl('https://docs.google.com/document/u/1/d/abc123/view')).toBe(
      canonicalUrl(doc),
    )
    expect(JSON.stringify(index)).not.toContain(ib.item.id)
    expect(JSON.stringify(index)).not.toContain(b.space.id)
    expect(JSON.stringify(index)).not.toContain('Secret')

    // The other Space's owner sees only their own item.
    const theirs = await h.ok('listItemIndex', {}, b.owner.token)
    expect(theirs.map((e) => e.itemId)).toEqual([ib.item.id])
  })

  it('drops a Space’s items once the caller leaves it, and an unshared item at once', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'IdxLeave')
    const shared = await h.ok(
      'shareItem',
      { params: { spaceId: space.id }, body: { page: page('https://example.com/leave', 'l') } },
      owner.token,
    )
    const kept = await h.ok(
      'shareItem',
      { params: { spaceId: space.id }, body: { page: page('https://example.com/kept', 'k') } },
      owner.token,
    )
    await h.settle()
    expect((await h.ok('listItemIndex', {}, member.token)).map((e) => e.itemId).sort()).toEqual(
      [shared.item.id, kept.item.id].sort(),
    )
    await h.ok('unshareItem', { params: { itemId: shared.item.id } }, owner.token)
    expect((await h.ok('listItemIndex', {}, member.token)).map((e) => e.itemId)).toEqual([
      kept.item.id,
    ])
    await h.ok(
      'removeMember',
      { params: { spaceId: space.id, userId: member.user.id } },
      owner.token,
    )
    expect(await h.ok('listItemIndex', {}, member.token)).toEqual([])
  })

  it('is empty for a user with no Spaces and refuses an anonymous caller', async () => {
    const loner = await h.login('Loner')
    expect(await h.ok('listItemIndex', {}, loner.token)).toEqual([])
    await h.fails('listItemIndex', {}, undefined, 401, 'unauthenticated')
  })

  it('has no lookup route any more: tab URLs are never sent to the server', async () => {
    const { token } = await h.login('NoLookup')
    const r = await h.app.inject({
      method: 'POST',
      url: '/v1/items/lookup',
      headers: { authorization: `Bearer ${token}` },
      payload: { urls: ['https://example.com/'] },
    })
    expect(r.statusCode).toBe(404)
  })
})

describe('search', () => {
  it('finds stored chunks of the Space only', async () => {
    const { owner, space } = await spaceWithMembers(h, 'Search')
    const other = await spaceWithMembers(h, 'SearchOther')
    const mine = await h.ok(
      'shareItem',
      { params: { spaceId: space.id }, body: { page: page('https://example.com/s', 'x') } },
      owner.token,
    )
    const theirs = await h.ok(
      'shareItem',
      { params: { spaceId: other.space.id }, body: { page: page('https://example.com/s', 'x') } },
      other.owner.token,
    )
    await h.settle()
    const chunkId = newId()
    await insertChunk(h, {
      id: chunkId,
      spaceId: space.id,
      itemId: mine.item.id,
      versionId: mine.item.currentVersion.id,
      ord: 0,
      text: 'Quarterly revenue grew in Osaka',
    })
    await insertChunk(h, {
      id: newId(),
      spaceId: other.space.id,
      itemId: theirs.item.id,
      versionId: theirs.item.currentVersion.id,
      ord: 0,
      text: 'Quarterly revenue grew in Osaka',
    })
    const hits = await h.ok(
      'search',
      { params: { spaceId: space.id }, body: { query: 'revenue' } },
      owner.token,
    )
    expect(hits.map((x) => x.chunkId)).toEqual([chunkId])
    expect(hits[0]).toMatchObject({ itemId: mine.item.id, headingPath: 'Intro' })
  })
})

describe('unshareItem', () => {
  it('deletes versions and chunks, scrubs quotes, keeps a tombstone and tells subscribers', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'Unshare')
    const port = await h.listen()
    const ws = await connectAs(port, owner.token, [space.id])
    const shared = await h.ok(
      'shareItem',
      {
        params: { spaceId: space.id },
        body: { page: page('https://example.com/u', 'secret text', 'Plan') },
      },
      member.token,
    )
    const kept = await h.ok(
      'shareItem',
      { params: { spaceId: space.id }, body: { page: page('https://example.com/k', 'kept') } },
      member.token,
    )
    await h.settle()
    await insertChunk(h, {
      id: newId(),
      spaceId: space.id,
      itemId: shared.item.id,
      versionId: shared.item.currentVersion.id,
      ord: 0,
      text: 'secret text',
    })

    // A stored answer citing both items.
    const thread = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      owner.token,
    )
    const cite = (
      n: number,
      item: typeof shared.item,
      quote: string,
    ): Omit<Citation, 'available'> => ({
      n,
      itemId: item.id,
      itemVersionId: item.currentVersion.id,
      versionNumber: item.currentVersion.number,
      title: item.title,
      url: item.url,
      sourceType: 'web',
      sharedBy: item.sharedBy,
      sharedAt: item.sharedAt,
      quote,
    })
    const messageId = newId()
    await h.sql`
      insert into messages (id, thread_id, role, author_id, content, citations, status)
      values (${messageId}, ${thread.id}, 'assistant', ${owner.user.id}, 'See [1] and [2]',
              ${h.sql.json([cite(1, shared.item, 'secret text'), cite(2, kept.item, 'kept')])}, 'complete')
    `

    // A member who did not share it cannot unshare; the owner can.
    const third = await h.login('Third')
    const { token: inv } = await h.ok(
      'createInvite',
      { params: { spaceId: space.id }, body: {} },
      owner.token,
    )
    await h.ok('acceptInvite', { body: { token: inv } }, third.token)
    await h.fails(
      'unshareItem',
      { params: { itemId: shared.item.id } },
      third.token,
      403,
      'forbidden',
    )
    await h.ok('unshareItem', { params: { itemId: shared.item.id } }, owner.token)

    const counts = await h.sql<{ items: number; versions: number; chunks: number }[]>`
      select (select count(*)::int from items where id = ${shared.item.id}) as items,
             (select count(*)::int from item_versions where item_id = ${shared.item.id}) as versions,
             (select count(*)::int from chunks where item_id = ${shared.item.id}) as chunks
    `
    expect(counts[0]).toEqual({ items: 0, versions: 0, chunks: 0 })
    const raw = await h.sql<
      { citations: Omit<Citation, 'available'>[] }[]
    >`select citations from messages where id = ${messageId}`
    expect(raw[0]?.citations.map((c) => c.quote)).toEqual(['', 'kept'])
    expect(JSON.stringify(await h.sql`select * from messages`)).not.toContain('secret text')

    const [msg] = await h.ok(
      'listMessages',
      { params: { threadId: thread.id }, query: {} },
      member.token,
    )
    expect(msg?.citations.map((c) => [c.n, c.available, c.quote])).toEqual([
      [1, false, ''],
      [2, true, 'kept'],
    ])

    const audit = await h.ok(
      'listAudit',
      { params: { spaceId: space.id }, query: {} },
      member.token,
    )
    expect(audit.find((a) => a.action === 'item.unshared')).toMatchObject({
      actor: { id: owner.user.id },
      target: { type: 'item', id: shared.item.id, title: 'Plan', url: 'https://example.com/u' },
    })
    expect(await ws.next('item.deleted')).toEqual({
      type: 'item.deleted',
      spaceId: space.id,
      itemId: shared.item.id,
      url: 'https://example.com/u',
    })
    await h.fails(
      'getItem',
      { params: { itemId: shared.item.id } },
      owner.token,
      404,
      'item_not_found',
    )
    ws.close()
  })

  it('lets the sharer unshare', async () => {
    const { member, space } = await spaceWithMembers(h, 'Sharer')
    const s = await h.ok(
      'shareItem',
      { params: { spaceId: space.id }, body: { page: page('https://example.com/m', 'm') } },
      member.token,
    )
    await h.ok('unshareItem', { params: { itemId: s.item.id } }, member.token)
    expect(await h.ok('listItems', { params: { spaceId: space.id } }, member.token)).toEqual([])
  })
})
