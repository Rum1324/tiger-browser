import type { SourceType, UserRef } from '@tiger/shared'
import type { Fragment, Sql } from '../db/sql'
import type { Retriever } from '../seams'
import { estimateTokens } from './chunker'

export type ContextMode = 'whole-space' | 'retrieval'

/** One numbered source for the prompt, with the provenance the answer's citations need. */
export interface ContextSource {
  /** 1-based; the `[n]` marker in an answer. */
  n: number
  itemId: string
  itemVersionId: string
  title: string
  url: string
  sourceType: SourceType
  sharedBy: UserRef
  /** ISO time of the first share of this item. */
  sharedAt: string
  /** What the model reads: the whole page (whole-space) or the selected passages joined by a gap line. */
  text: string
  /** The pieces `text` is made of. Whole-space mode has one passage with an empty heading path. */
  passages: { headingPath: string; text: string }[]
}

export interface BuiltContext {
  mode: ContextMode
  sources: ContextSource[]
  /** Estimated tokens of the sources as rendered by `renderContext`. */
  estimatedTokens: number
  /** Total characters of every current item version in the Space, whichever mode was used. */
  spaceChars: number
  /** Number of items in the Space with content. */
  itemCount: number
}

export interface ContextBuilderOptions {
  /** A Space whose estimated tokens are at or below this is injected whole. */
  wholeSpaceMaxTokens?: number
  /** Chunks to retrieve in retrieval mode. */
  k?: number
  /** Chunks on each side of a hit that are added to it, merged with adjacent hits. */
  neighbourRadius?: number
}

export interface ContextBuilder {
  /**
   * Sources for one question in one Space (membership is the caller's job).
   *
   * Whole-space mode returns every current item version ordered by first share time then item id, so
   * the rendered prefix stays byte-identical between questions and a new share only appends at the
   * end (a provider prompt-cache breakpoint after the sources keeps hitting). Retrieval mode returns
   * the best chunks grouped by item, numbered in order of best rank, neighbouring chunks merged.
   */
  build(input: { spaceId: string; question: string; signal?: AbortSignal }): Promise<BuiltContext>
}

const DEFAULT_WHOLE_SPACE_TOKENS = 40_000
const DEFAULT_K = 10
const DEFAULT_RADIUS = 1
/** Every character of any script costs at least this many tokens; lets us skip loading huge Spaces. */
const MIN_TOKENS_PER_CHAR = 0.2
const SOURCE_OVERHEAD_TOKENS = 60

interface ItemRow {
  item_id: string
  version_id: string
  title: string
  url: string
  source_type: SourceType
  shared_at: Date
  user_id: string
  user_name: string
  avatar_url: string | null
}

export function createContextBuilder(deps: {
  sql: Sql
  retriever: Retriever
  options?: ContextBuilderOptions
}): ContextBuilder {
  const wholeMax = deps.options?.wholeSpaceMaxTokens ?? DEFAULT_WHOLE_SPACE_TOKENS
  const k = deps.options?.k ?? DEFAULT_K
  const radius = deps.options?.neighbourRadius ?? DEFAULT_RADIUS
  const { sql } = deps

  const baseSelect = (spaceId: string) => sql`
    select i.id as item_id, i.current_version_id as version_id, i.title, i.url, i.source_type,
           i.shared_at, u.id as user_id, u.name as user_name, u.avatar_url
    from items i
    join users u on u.id = i.shared_by
    where i.space_id = ${spaceId} and i.current_version_id is not null
  `
  const toSource = (r: ItemRow, n: number, passages: ContextSource['passages']): ContextSource => ({
    n,
    itemId: r.item_id,
    itemVersionId: r.version_id,
    title: r.title,
    url: r.url,
    sourceType: r.source_type,
    sharedBy: { id: r.user_id, name: r.user_name, avatarUrl: r.avatar_url },
    sharedAt: r.shared_at.toISOString(),
    passages,
    text: passages.map((p) => p.text).join('\n…\n'),
  })

  return {
    async build({ spaceId, question, signal }) {
      const [totals] = await sql<{ chars: string; items: string }[]>`
        select coalesce(sum(v.char_count), 0) as chars, count(*) as items
        from items i join item_versions v on v.id = i.current_version_id
        where i.space_id = ${spaceId}
      `
      const spaceChars = Number(totals?.chars ?? 0)
      const itemCount = Number(totals?.items ?? 0)
      if (itemCount === 0) {
        return { mode: 'whole-space', sources: [], estimatedTokens: 0, spaceChars, itemCount }
      }

      if (spaceChars * MIN_TOKENS_PER_CHAR <= wholeMax) {
        const rows = await sql<(ItemRow & { markdown: string })[]>`
          select r.*, v.markdown from (${baseSelect(spaceId)}) r
          join item_versions v on v.id = r.version_id
          order by r.shared_at, r.item_id
        `
        const sources = rows.map((r, idx) =>
          toSource(r, idx + 1, [{ headingPath: '', text: r.markdown }]),
        )
        const estimatedTokens = estimateContext(sources)
        if (estimatedTokens <= wholeMax) {
          return { mode: 'whole-space', sources, estimatedTokens, spaceChars, itemCount }
        }
      }

      const hits = await deps.retriever.search({
        spaceId,
        query: question,
        k,
        signal: signal ?? new AbortController().signal,
      })
      const sources = await passagesFromHits(sql, spaceId, hits, radius, baseSelect, toSource)
      return {
        mode: 'retrieval',
        sources,
        estimatedTokens: estimateContext(sources),
        spaceChars,
        itemCount,
      }
    },
  }
}

async function passagesFromHits(
  sql: Sql,
  spaceId: string,
  hits: { itemVersionId: string; chunkId: string }[],
  radius: number,
  baseSelect: (spaceId: string) => Fragment,
  toSource: (r: ItemRow, n: number, p: ContextSource['passages']) => ContextSource,
): Promise<ContextSource[]> {
  if (hits.length === 0) return []
  const chunkIds = hits.map((h) => h.chunkId)
  const hitRows = await sql<{ id: string; item_version_id: string; ord: number }[]>`
    select id, item_version_id, ord from chunks
    where id = any(${chunkIds}::uuid[]) and space_id = ${spaceId}
  `
  const hitById = new Map(hitRows.map((r) => [r.id, r]))

  // Item order = rank of the item's best chunk; ords of that item's hits are collected as ranges.
  const order: string[] = []
  const ords = new Map<string, Set<number>>()
  for (const h of hits) {
    const row = hitById.get(h.chunkId)
    if (!row) continue
    if (!ords.has(row.item_version_id)) {
      order.push(row.item_version_id)
      ords.set(row.item_version_id, new Set())
    }
    ords.get(row.item_version_id)?.add(row.ord)
  }
  if (order.length === 0) return []

  const wanted = order.flatMap((versionId) => {
    const set = new Set<number>()
    for (const o of ords.get(versionId) ?? []) {
      for (let d = -radius; d <= radius; d++) if (o + d >= 0) set.add(o + d)
    }
    return [...set].map((ord) => ({ versionId, ord }))
  })
  const chunkRows = await sql<
    { item_version_id: string; ord: number; heading_path: string; text: string }[]
  >`
    select c.item_version_id, c.ord, c.heading_path, c.text
    from chunks c
    join unnest(${wanted.map((w) => w.versionId)}::uuid[], ${wanted.map((w) => w.ord)}::int[])
      as w(version_id, ord) on w.version_id = c.item_version_id and w.ord = c.ord
    where c.space_id = ${spaceId}
    order by c.item_version_id, c.ord
  `
  const itemRows = await sql<ItemRow[]>`
    select r.* from (${baseSelect(spaceId)}) r
    where r.version_id = any(${order}::uuid[])
  `
  const itemByVersion = new Map(itemRows.map((r) => [r.version_id, r]))

  const sources: ContextSource[] = []
  for (const versionId of order) {
    const item = itemByVersion.get(versionId)
    if (!item) continue
    // Consecutive ords form one passage; a gap in ords starts the next one.
    const passages: ContextSource['passages'] = []
    let prevOrd = -2
    let run: { headingPath: string; parts: string[] } | null = null
    const close = () => {
      if (run) passages.push({ headingPath: run.headingPath, text: run.parts.join('\n') })
      run = null
    }
    for (const c of chunkRows.filter((r) => r.item_version_id === versionId)) {
      if (c.ord !== prevOrd + 1) close()
      if (!run) run = { headingPath: c.heading_path, parts: [] }
      run.parts.push(c.text)
      prevOrd = c.ord
    }
    close()
    sources.push(toSource(item, sources.length + 1, passages))
  }
  return sources
}

function estimateContext(sources: ContextSource[]): number {
  return sources.reduce((sum, s) => sum + SOURCE_OVERHEAD_TOKENS + estimateTokens(s.text), 0)
}

/** A source's own block tags cannot be written by its text; deterministic, so caching holds. */
function defuseSourceTags(text: string): string {
  return text.replace(/<(\/?)(source)/gi, '<$1\u200b$2')
}

/** One line: a newline in a title or name could otherwise start a forged header line. */
function oneLine(text: string): string {
  return defuseSourceTags(text.replace(/\s+/g, ' ').trim())
}

/**
 * Deterministic prompt text for the sources: the same sources always give the same bytes. Nothing in
 * it depends on the question or the time of the request.
 *
 * Each source is a `<source n="k">` block whose header (title, URL, type, sharer) is the first lines
 * after the opening tag. Page text can neither open nor close a block, and header fields are single
 * lines, so a page cannot pass off text of its own as another numbered source.
 */
export function renderContext(context: Pick<BuiltContext, 'sources'>): string {
  return context.sources
    .map((s) => {
      const header = `[${s.n}] ${oneLine(s.title)}\nURL: ${oneLine(s.url)}\nType: ${s.sourceType}; shared by ${oneLine(s.sharedBy.name)} on ${s.sharedAt.slice(0, 10)}`
      return `<source n="${s.n}">\n${header}\n\n${defuseSourceTags(s.text)}\n</source>`
    })
    .join('\n\n')
}
