import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app'
import { newId } from '../src/ids'
import type { Indexer, IndexInput } from '../src/seams'
import { recoverInterruptedWork } from '../src/services/recovery'
import { spaceWithMembers } from './helpers/fixtures'
import { type Harness, page, startHarness } from './helpers/harness'

/** First instance: an indexer that only finishes when shutdown aborts it, as a deploy would. */
const hangingIndexer: Indexer = {
  index: (input) =>
    new Promise<void>((_resolve, reject) => {
      input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true })
    }),
}
const indexed: IndexInput[] = []
const recordingIndexer: Indexer = {
  async index(input) {
    indexed.push(input)
  },
}

let h: Harness
beforeAll(async () => {
  h = await startHarness({ indexer: hangingIndexer })
})
afterAll(async () => {
  await h.db.drop()
})

describe('work interrupted by a shutdown or crash', () => {
  it('indexing cut short by shutdown is not marked failed and is re-run on the next start', async () => {
    const { owner, space } = await spaceWithMembers(h, 'Deploy')
    const shared = await h.ok(
      'shareItem',
      {
        params: { spaceId: space.id },
        body: { page: page('https://example.com/deploy', '# Deploy\n\nBody text.') },
      },
      owner.token,
    )
    // A crashed answer: the row says streaming but no process holds its stream.
    const thread = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      owner.token,
    )
    const crashedId = newId()
    await h.sql`
      insert into messages (id, thread_id, role, author_id, content, status)
      values (${crashedId}, ${thread.id}, 'assistant', ${owner.user.id}, '', 'streaming')
    `
    await h.app.close()
    const [afterClose] = await h.sql<
      { status: string }[]
    >`select status from items where id = ${shared.item.id}`
    expect(afterClose?.status).toBe('indexing')

    // Second instance on the same database.
    const next = await buildApp({
      sql: h.sql,
      config: h.config,
      logger: false,
      indexer: recordingIndexer,
    })
    try {
      await recoverInterruptedWork(next.tiger)
      await next.tiger.background.drain()
      expect(indexed.map((i) => i.itemId)).toContain(shared.item.id)
      const [item] = await h.sql<
        { status: string }[]
      >`select status from items where id = ${shared.item.id}`
      expect(item?.status).toBe('ready')
      const [msg] = await h.sql<{ status: string; error_code: string | null }[]>`
        select status, error_code from messages where id = ${crashedId}
      `
      expect(msg).toEqual({ status: 'error', error_code: 'ai_interrupted' })

      // A share of identical content re-indexes an item that is not ready.
      await h.sql`update items set status = 'failed' where id = ${shared.item.id}`
      indexed.length = 0
      const res = await next.inject({
        method: 'POST',
        url: `/v1/spaces/${space.id}/items`,
        headers: { authorization: `Bearer ${owner.token}` },
        payload: { page: page('https://example.com/deploy', '# Deploy\n\nBody text.') },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().outcome).toBe('unchanged')
      await next.tiger.background.drain()
      expect(indexed.map((i) => i.itemId)).toEqual([shared.item.id])
      const [again] = await h.sql<
        { status: string }[]
      >`select status from items where id = ${shared.item.id}`
      expect(again?.status).toBe('ready')
    } finally {
      await next.close()
    }
  })
})
