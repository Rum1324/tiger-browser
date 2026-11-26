import type { SearchHit } from '@tiger/shared'
import type { Sql } from '../db/sql'
import type { Retriever, SearchInput } from '../seams'
import { type Embedder, toVectorLiteral } from './embedder'

export interface HybridOptions {
  /** Weight of the keyword leg against the vector leg (1.0). 0 turns the keyword leg off. */
  keywordWeight?: number
  /** Reciprocal rank fusion constant. */
  rrfK?: number
  /** Skip the exact-token gate and run the keyword leg on every query (benchmarking only). */
  alwaysKeyword?: boolean
}

const DEFAULT_RRF_K = 60
const DEFAULT_KEYWORD_WEIGHT = 0.5
/** Queries up to this many characters (spaces ignored) count as a short term. */
const SHORT_TERM_CHARS = 3

const QUOTED = /"([^"]{1,200})"|“([^”]{1,200})”|「([^」]{1,200})」|『([^』]{1,200})』/g
// A Latin token that is an identifier rather than a word: has a digit (ERR-4012, v2.3.1, 1on1), an
// underscore (user_id), an uppercase letter around - . / : (Foo-Bar), is an all-caps acronym (KPI, SAFE),
// or camelCase.
const TOKEN = /[A-Za-z0-9][A-Za-z0-9_./:-]*[A-Za-z0-9]|[A-Za-z0-9]/g

function isIdentifier(token: string): boolean {
  if (/\d/.test(token)) return token.length >= 2
  if (token.includes('_')) return true
  // Lowercase compounds such as "post-money" or "e-mail" are ordinary words, not identifiers.
  if (/[./:-]/.test(token)) return /[A-Z]/.test(token)
  if (/^[A-Z]{2,}$/.test(token)) return true
  return /[a-z][A-Z]/.test(token)
}

/**
 * Terms for the keyword leg, or an empty list when the query shows no exact-token signal.
 * Signals: a quoted phrase, an alphanumeric identifier, or a short term (a bare two-kanji word such
 * as 稟議 that embeddings may blur). Natural-language questions get no keyword leg: on the benchmark
 * an ungated keyword leg lowered MRR for a strong embedder (docs/research/retrieval-jp.md).
 */
export function keywordTerms(query: string): string[] {
  const terms: string[] = []
  const stripped = query.replace(QUOTED, (_m, a, b, c, d) => {
    terms.push(String(a ?? b ?? c ?? d).trim())
    return ' '
  })
  for (const token of stripped.match(TOKEN) ?? []) if (isIdentifier(token)) terms.push(token)
  const compact = query.replace(/\s+/g, '')
  if (terms.length === 0 && compact.length > 0 && compact.length <= SHORT_TERM_CHARS) {
    terms.push(query.trim())
  }
  return [...new Set(terms.filter((t) => t !== ''))]
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

interface Ranked {
  id: string
}

/** Weighted reciprocal rank fusion of ranked id lists; ties break by id so the order is stable. */
export function fuse(
  legs: { ids: string[]; weight: number }[],
  rrfK = DEFAULT_RRF_K,
): { id: string; score: number }[] {
  const scores = new Map<string, number>()
  for (const leg of legs) {
    leg.ids.forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0) + leg.weight / (rrfK + i + 1))
    })
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
}

/**
 * Vector search first; a pg_trgm keyword leg joins only for queries with an exact-token signal.
 * Both legs filter on space_id inside their own query, so one Space's chunks are never candidates for
 * another. `hnsw.iterative_scan = relaxed_order` is required: without it a selective space_id filter
 * on the HNSW index returns fewer rows than asked for, or none (measured in the research doc).
 */
export function createRetriever(deps: {
  sql: Sql
  embedder: Embedder
  options?: HybridOptions
}): Retriever {
  const keywordWeight = deps.options?.keywordWeight ?? DEFAULT_KEYWORD_WEIGHT
  const rrfK = deps.options?.rrfK ?? DEFAULT_RRF_K
  const always = deps.options?.alwaysKeyword ?? false

  return {
    async search({ spaceId, query, k, signal }: SearchInput): Promise<SearchHit[]> {
      const q = query.trim()
      if (q === '' || k <= 0) return []
      signal.throwIfAborted()
      const [queryVector] = await deps.embedder.embedQueries([q], signal)
      if (!queryVector) return []
      const vec = toVectorLiteral(queryVector)
      // Over-fetch so chunks of superseded versions and fusion ties do not shrink the result.
      const pool = Math.max(30, k * 3)
      const terms = keywordWeight > 0 ? keywordTerms(q) : []
      const useKeyword = terms.length > 0 || (always && keywordWeight > 0)
      const kwTerms = terms.length > 0 ? terms : [q]

      const { vectorIds, keywordIds } = await deps.sql.begin(async (tx) => {
        await tx`set local hnsw.iterative_scan = relaxed_order`
        await tx`set local hnsw.ef_search = 100`
        // The inner query uses the index; the outer sort fixes relaxed_order's approximate order.
        const v = await tx<Ranked[]>`
          select id from (
            select id, embedding <=> ${vec}::vector as d
            from chunks
            where space_id = ${spaceId}
            order by embedding <=> ${vec}::vector
            limit ${pool}
          ) near
          order by d, id
        `
        if (!useKeyword) return { vectorIds: v.map((r) => r.id), keywordIds: [] as string[] }
        const patterns = kwTerms.map((t) => `%${escapeLike(t)}%`)
        const kw = await tx<Ranked[]>`
          select c.id
          from chunks c
          where c.space_id = ${spaceId} and c.text ilike any (${patterns}::text[])
          order by
            (select count(*) from unnest(${patterns}::text[]) p where c.text ilike p) desc,
            (select max(word_similarity(t, c.text)) from unnest(${kwTerms}::text[]) t) desc,
            c.id
          limit ${pool}
        `
        return { vectorIds: v.map((r) => r.id), keywordIds: kw.map((r) => r.id) }
      })

      const fused = fuse(
        [
          { ids: vectorIds, weight: 1 },
          { ids: keywordIds, weight: keywordWeight },
        ],
        rrfK,
      )
      if (fused.length === 0) return []
      const ids = fused.map((f) => f.id)
      const rows = await deps.sql<
        {
          chunk_id: string
          item_id: string
          item_version_id: string
          title: string
          url: string
          heading_path: string
          text: string
        }[]
      >`
        select c.id as chunk_id, c.item_id, c.item_version_id, i.title, i.url, c.heading_path, c.text
        from chunks c
        join items i on i.id = c.item_id and i.current_version_id = c.item_version_id
        where c.id = any(${ids}::uuid[]) and c.space_id = ${spaceId}
      `
      const byId = new Map(rows.map((r) => [r.chunk_id, r]))
      const hits: SearchHit[] = []
      for (const f of fused) {
        const r = byId.get(f.id)
        if (!r) continue
        hits.push({
          itemId: r.item_id,
          itemVersionId: r.item_version_id,
          chunkId: r.chunk_id,
          title: r.title,
          url: r.url,
          headingPath: r.heading_path,
          text: r.text,
          score: f.score,
        })
        if (hits.length === k) break
      }
      return hits
    },
  }
}
