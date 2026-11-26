import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newId } from '../../src/ids'
import {
  createRetriever,
  EMBEDDING_DIMENSIONS,
  HashEmbedder,
  toVectorLiteral,
} from '../../src/retrieval'
import { createTestDb, TEST_DATABASE_URL, type TestDb } from '../helpers/db'

const SPACES = 100
const PER_SPACE = 300
const signal = new AbortController().signal

let db: TestDb
/** A pool that cannot seq-scan, so the planner must answer the filtered query from the HNSW index. */
let forced: ReturnType<typeof postgres>
let target: string
let queryVector: Float32Array

/** A Space that holds 1% of a 30 000-row table, all rows with random vectors. */
beforeAll(async () => {
  db = await createTestDb()
  const { sql } = db
  const user = newId()
  await sql`insert into users (id, email, name) values (${user}, 'seed@example.com', 'Seed')`
  await sql`
    insert into spaces (id, name, created_by)
    select gen_random_uuid(), 's' || g, ${user} from generate_series(1, ${SPACES}) g
  `
  await sql`
    insert into items (id, space_id, url, url_key, title, source_type, shared_by)
    select gen_random_uuid(), s.id, 'https://example.com/' || s.name, 'https://example.com/' || s.name,
           s.name, 'web', ${user}
    from spaces s
  `
  await sql`
    insert into item_versions (id, item_id, number, markdown, content_hash, char_count, extractor, captured_at, captured_by)
    select gen_random_uuid(), i.id, 1, '', i.id::text, 0, 'test', now(), ${user} from items i
  `
  await sql`update items i set current_version_id = (select v.id from item_versions v where v.item_id = i.id)`
  await sql`drop index chunks_embedding_idx`
  // With the btree on space_id the planner would answer a 1% Space exactly and never touch HNSW. A
  // production table large enough to flip that choice behaves like this one without the btree.
  await sql`drop index chunks_space_idx`
  await sql`
    insert into chunks (id, space_id, item_id, item_version_id, ord, heading_path, text, char_count, embedding)
    select gen_random_uuid(), i.space_id, i.id, i.current_version_id, g, '', 'filler ' || g, 10,
           (select array_agg(random() - 0.5) from generate_series(1, ${EMBEDDING_DIMENSIONS}) d(x) where x > g * 0)::vector
    from items i, generate_series(1, ${PER_SPACE}) g
  `
  await sql`create index chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops)`
  await sql`analyze chunks`
  const [row] = await sql<{ space_id: string; v: string }[]>`
    select space_id, embedding::text as v from chunks order by id limit 1
  `
  forced = postgres(TEST_DATABASE_URL, {
    max: 2,
    onnotice: () => {},
    connection: {
      search_path: `${db.schema}, public`,
      enable_seqscan: 'off',
      enable_bitmapscan: 'off',
    },
  })
  target = row?.space_id ?? ''
  queryVector = Float32Array.from(JSON.parse(row?.v ?? '[]') as number[])
}, 120_000)

afterAll(async () => {
  await forced.end({ timeout: 5 })
  await db.drop()
})

/** The plain filtered query with no iterative scan, planned onto the HNSW index. */
async function plainFilteredCount(iterative: boolean): Promise<number> {
  return db.sql.begin(async (tx) => {
    await tx`set local enable_seqscan = off`
    await tx`set local enable_bitmapscan = off`
    await tx`set local enable_indexscan = off`
    if (iterative) await tx`set local hnsw.iterative_scan = relaxed_order`
    const vec = toVectorLiteral(queryVector)
    const rows = await tx`
      select id from chunks where space_id = ${target}
      order by embedding <=> ${vec}::vector limit 30
    `
    return rows.length
  })
}

describe('filtered HNSW search when the Space is 1% of the table', () => {
  it('the problem is real: without iterative scan the same query returns too few rows', async () => {
    const without = await plainFilteredCount(false)
    const withScan = await plainFilteredCount(true)
    expect(without).toBeLessThan(30)
    expect(withScan).toBe(30)
  })

  it('the retriever returns a full page for the small Space and nothing from other Spaces', async () => {
    // A query embedder that hands back the stored vector, so the nearest chunk is known.
    const fixed = {
      id: 'fixed',
      embedPassages: async () => [],
      embedQueries: async () => [queryVector],
    }
    const retriever = createRetriever({
      sql: forced,
      embedder: { ...new HashEmbedder(), ...fixed },
    })
    const hits = await retriever.search({ spaceId: target, query: 'anything', k: 20, signal })
    expect(hits).toHaveLength(20)
    const [other] = await db.sql<
      { id: string }[]
    >`select id from spaces where id <> ${target} limit 1`
    const others = await retriever.search({
      spaceId: other?.id ?? '',
      query: 'anything',
      k: 20,
      signal,
    })
    expect(others).toHaveLength(20)
    const rows = await db.sql<{ space_id: string }[]>`
      select space_id from chunks where id = any(${hits.map((x) => x.chunkId)}::uuid[])
    `
    expect(new Set(rows.map((r) => r.space_id))).toEqual(new Set([target]))
    // The stored vector itself is the nearest neighbour.
    const [self] = await db.sql<{ id: string }[]>`
      select id from chunks where space_id = ${target} order by embedding <=> ${toVectorLiteral(queryVector)}::vector limit 1
    `
    expect(hits[0]?.chunkId).toBe(self?.id)
  })
})
