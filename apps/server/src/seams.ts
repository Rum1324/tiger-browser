import type {
  Citation,
  Message,
  ModelInfo,
  ModelRef,
  SearchHit,
  SourceType,
  Thread,
  TokenUsage,
  User,
} from '@tiger/shared'
import type { Sql } from './db/sql'

/**
 * Seams between the server core and the parts built separately (retrieval, chat). Each has a
 * production-neutral default here; the real implementations are passed to buildApp. Nothing in these
 * interfaces requires importing server internals: inputs are contract types plus plain data.
 */

// ── Indexer ─────────────────────────────────────────────────────────────────

export interface IndexInput {
  spaceId: string
  itemId: string
  itemVersionId: string
  url: string
  title: string
  sourceType: SourceType
  markdown: string
  lang: string | null
  signal: AbortSignal
}

/**
 * Turns one item version into retrieval chunks. Resolve when the chunks for `itemVersionId` are stored;
 * reject to mark the item `failed`. The server then marks the item `ready` and deletes chunks of every
 * other version of the item in the same transaction, so a slow run for an older version can never
 * leave stale chunks behind. Runs in the background, after the share request has returned.
 */
export interface Indexer {
  index(input: IndexInput): Promise<void>
}

/** Stores no chunks: items become `ready` and are reachable only by whole-item injection. */
export const noopIndexer: Indexer = {
  async index() {},
}

// ── Retriever ───────────────────────────────────────────────────────────────

export interface SearchInput {
  spaceId: string
  query: string
  k: number
  signal: AbortSignal
}

/** Backs POST /v1/spaces/:spaceId/search. Membership is checked before this is called. */
export interface Retriever {
  search(input: SearchInput): Promise<SearchHit[]>
}

/**
 * Keyword search over stored chunks with pg_trgm word similarity. No embeddings needed, so it works
 * with whatever chunks exist; the retrieval part replaces it with the hybrid vector search.
 */
export function trigramRetriever(sql: Sql): Retriever {
  return {
    async search({ spaceId, query, k }) {
      const rows = await sql<
        {
          chunk_id: string
          item_id: string
          item_version_id: string
          title: string
          url: string
          heading_path: string
          text: string
          score: number
        }[]
      >`
        select c.id as chunk_id, c.item_id, c.item_version_id, i.title, i.url, c.heading_path, c.text,
               word_similarity(${query}, c.text)::float8 as score
        from chunks c
        join items i on i.id = c.item_id and i.current_version_id = c.item_version_id
        where c.space_id = ${spaceId}
          and (${query} <% c.text or c.text ilike '%' || ${escapeLike(query)} || '%')
        order by score desc, c.id
        limit ${k}
      `
      return rows.map((r) => ({
        itemId: r.item_id,
        itemVersionId: r.item_version_id,
        chunkId: r.chunk_id,
        title: r.title,
        url: r.url,
        headingPath: r.heading_path,
        text: r.text,
        score: r.score,
      }))
    },
  }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

// ── Model directory ─────────────────────────────────────────────────────────

export interface ModelDirectory {
  /** `defaultModel` is null when no model can be used (no provider configured). */
  list(): Promise<{ models: ModelInfo[]; defaultModel: ModelRef | null }>
}

export const emptyModelDirectory: ModelDirectory = {
  async list() {
    return { models: [], defaultModel: null }
  },
}

// ── Answerer ────────────────────────────────────────────────────────────────

/** A page attached to the new message, with its content. Private threads only. */
export interface AttachmentContent {
  url: string
  title: string
  sourceType: SourceType
  markdown: string
  charCount: number
}

/**
 * Citations given to `sources` or returned in the result may omit `available`; the server computes it.
 * Citations to items outside the thread's Space are dropped by the server.
 */
export type CitationInput = Omit<Citation, 'available'> & { available?: boolean }

export type AnswerEvent =
  /** Appended text, forwarded to clients as `message.delta` in order. */
  | { type: 'delta'; text: string }
  /** Sources known so far (the full list each time), forwarded as `message.sources`. */
  | { type: 'sources'; citations: CitationInput[] }

export interface AnswerUsage extends TokenUsage {
  cacheWriteTokens?: number
  costUsd?: number | null
}

export interface AnswerInput {
  thread: Thread
  spaceId: string
  /** The member who asked. */
  user: User
  model: ModelRef
  /** Earlier messages of the thread, oldest first, without the new message and the placeholder. */
  history: Message[]
  /** The message that asked for this answer. */
  message: Message
  /** Pages attached to `message`, with content. Empty on Space threads. */
  attachments: AttachmentContent[]
  /** Id of the assistant placeholder this answer fills. */
  assistantMessageId: string
  emit: (event: AnswerEvent) => void
  /** Aborted when the thread is deleted or the server shuts down. */
  signal: AbortSignal
}

export interface AnswerResult {
  content: string
  citations: CitationInput[]
  usage: AnswerUsage
}

export interface Answerer {
  answer(input: AnswerInput): Promise<AnswerResult>
}

/**
 * Throw this from an Answerer to fail the assistant message with a stable code the UI understands.
 * Any other error fails it with `ai_failed`. Tokens already spent can be reported through `usage`.
 */
export class AnswerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly usage?: AnswerUsage,
  ) {
    super(message)
    this.name = 'AnswerError'
  }
}

export const unavailableAnswerer: Answerer = {
  async answer() {
    throw new AnswerError('ai_unavailable', 'No AI provider is configured on this server')
  },
}

// ── Google sign-in ──────────────────────────────────────────────────────────

export interface GoogleIdentity {
  sub: string
  email: string
  emailVerified: boolean
  name: string | null
  picture: string | null
}

/** Verifies a Google ID token and returns its claims; throws when the token is not valid. */
export type VerifyGoogleIdToken = (idToken: string) => Promise<GoogleIdentity>
