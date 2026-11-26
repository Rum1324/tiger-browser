import { readFileSync, writeFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRetriever, E5Embedder, keywordTerms } from '../../src/retrieval'
import { spaceWithMembers } from '../helpers/fixtures'
import type { Harness } from '../helpers/harness'
import { MODEL_CACHE_DIR, share, startRetrievalHarness } from './helpers'

interface Passage {
  id: string
  topic: string
  title: string
  text: string
}
interface Query {
  id: string
  kind: string
  query: string
  relevant: string[]
}

const read = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../../bench/retrieval/${name}`, import.meta.url), 'utf8')) as T
const corpus = read<Passage[]>('corpus.json')
const queries = read<Query[]>('queries.json')
const signal = new AbortController().signal

let h: Harness
let spaceId: string
let passageOfItem: Map<string, string>
let embedder: E5Embedder

beforeAll(async () => {
  embedder = new E5Embedder({ cacheDir: MODEL_CACHE_DIR })
  const started = await startRetrievalHarness(embedder)
  h = started.h
  const { owner, space } = await spaceWithMembers(h, 'Bench')
  spaceId = space.id
  passageOfItem = new Map()
  // The real path: share through the API, the server runs the real indexer in the background.
  for (const p of corpus) {
    const item = await share(
      h,
      owner.token,
      space.id,
      `https://bench.example/${p.id}`,
      p.title,
      p.text,
    )
    passageOfItem.set(item.id, p.id)
  }
}, 180_000)
afterAll(() => h.close())

async function evaluate(options: { keywordWeight: number; alwaysKeyword?: boolean }) {
  const retriever = createRetriever({ sql: h.sql, embedder, options })
  let hit5 = 0
  let rr = 0
  const misses: string[] = []
  for (const q of queries) {
    const hits = await retriever.search({ spaceId, query: q.query, k: 20, signal })
    const items: string[] = []
    for (const x of hits) {
      const p = passageOfItem.get(x.itemId)
      if (p && !items.includes(p)) items.push(p)
    }
    const rank = items.findIndex((p) => q.relevant.includes(p)) + 1
    if (rank > 0 && rank <= 5) hit5++
    else misses.push(`${q.id} ${q.query} (rank ${rank || '>20'})`)
    if (rank > 0) rr += 1 / rank
  }
  return { recall5: hit5 / queries.length, mrr: rr / queries.length, misses }
}

describe('benchmark corpus through the real pipeline (e5-small q8, real Postgres)', () => {
  it('reports recall@5 and MRR for vector-only and the gated hybrid', async () => {
    expect(corpus).toHaveLength(40)
    expect(queries).toHaveLength(20)
    const counted = await h.sql<{ n: string }[]>`
      select count(*) as n from chunks where space_id = ${spaceId}
    `
    expect(Number(counted[0]?.n)).toBeGreaterThanOrEqual(40)

    const vectorOnly = await evaluate({ keywordWeight: 0 })
    const gated = await evaluate({ keywordWeight: 0.5 })
    const ungated = await evaluate({ keywordWeight: 0.5, alwaysKeyword: true })
    const gateOpen = queries.filter((q) => keywordTerms(q.query).length > 0).map((q) => q.query)

    const fmt = (r: { recall5: number; mrr: number }) =>
      `recall@5 ${r.recall5.toFixed(2)}  MRR ${r.mrr.toFixed(3)}`
    const report = [
      `vector-only        ${fmt(vectorOnly)}  misses: ${vectorOnly.misses.join('; ') || 'none'}`,
      `hybrid, gated      ${fmt(gated)}  misses: ${gated.misses.join('; ') || 'none'}`,
      `hybrid, ungated    ${fmt(ungated)}  misses: ${ungated.misses.join('; ') || 'none'}`,
      `gate opened for ${gateOpen.length}/${queries.length} queries: ${gateOpen.join(' | ')}`,
    ].join('\n')
    console.info(`\n${report}\n`)
    if (process.env.TIGER_BENCH_OUT) writeFileSync(process.env.TIGER_BENCH_OUT, `${report}\n`)

    // Sanity floors from the research run (vector-only e5-small: recall@5 1.00, MRR 0.950). They
    // catch a broken pipeline; they do not claim hybrid beats vector-only.
    expect(vectorOnly.recall5).toBeGreaterThanOrEqual(0.9)
    expect(vectorOnly.mrr).toBeGreaterThanOrEqual(0.8)
    expect(gated.recall5).toBeGreaterThanOrEqual(0.9)
    expect(gated.mrr).toBeGreaterThanOrEqual(0.8)
    // The gate is selective: it opens for some queries and not for all.
    expect(gateOpen.length).toBeGreaterThan(0)
    expect(gateOpen.length).toBeLessThan(queries.length)
  }, 120_000)
})
