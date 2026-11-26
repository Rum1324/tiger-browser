import type { Sql } from '../db/sql'
import { newId } from '../ids'
import type { Indexer, IndexInput } from '../seams'
import { type Chunk, chunkMarkdown } from './chunker'
import { type Embedder, toVectorLiteral } from './embedder'

/** The text the embedder sees for a chunk: document title and heading path give each chunk its topic. */
export function chunkEmbedText(title: string, chunk: Pick<Chunk, 'headingPath' | 'text'>): string {
  const head = [title, chunk.headingPath].filter((s) => s !== '').join(' > ')
  return head ? `${head}\n${chunk.text}` : chunk.text
}

const INSERT_BATCH = 200

/**
 * Chunk and embed one item version, then replace the item's chunks in a single transaction.
 *
 * Embedding happens before the transaction, so a crash or an embedder error leaves the previous
 * chunks untouched and never a half-written index. The transaction locks the item row and does
 * nothing when `itemVersionId` is no longer the current version (a newer share overtook this run) or
 * the item was unshared meanwhile, so a slow old run cannot overwrite newer chunks.
 */
export function createIndexer(deps: { sql: Sql; embedder: Embedder }): Indexer {
  return {
    async index(input: IndexInput): Promise<void> {
      const chunks = chunkMarkdown(input.markdown, { title: input.title })
      const vectors = await deps.embedder.embedPassages(
        chunks.map((c) => chunkEmbedText(input.title, c)),
        input.signal,
      )
      if (vectors.length !== chunks.length) {
        throw new Error('embedder returned a different number of vectors than chunks')
      }
      input.signal.throwIfAborted()

      await deps.sql.begin(async (tx) => {
        const rows = await tx<{ current_version_id: string | null }[]>`
          select current_version_id from items
          where id = ${input.itemId} and space_id = ${input.spaceId}
          for update
        `
        if (rows[0]?.current_version_id !== input.itemVersionId) return
        await tx`delete from chunks where item_id = ${input.itemId}`
        for (let start = 0; start < chunks.length; start += INSERT_BATCH) {
          const part = chunks.slice(start, start + INSERT_BATCH)
          const literals = part.map((_, i) => toVectorLiteral(vectors[start + i] as Float32Array))
          await tx`
            insert into chunks
              (id, space_id, item_id, item_version_id, ord, heading_path, text, char_count, embedding)
            select t.id, ${input.spaceId}, ${input.itemId}, ${input.itemVersionId}, t.ord,
                   t.heading_path, t.text, t.char_count, t.embedding::vector
            from unnest(
              ${part.map(() => newId())}::uuid[],
              ${part.map((c) => c.ord)}::int[],
              ${part.map((c) => c.headingPath)}::text[],
              ${part.map((c) => c.text)}::text[],
              ${part.map((c) => c.charCount)}::int[],
              ${literals}::text[]
            ) as t(id, ord, heading_path, text, char_count, embedding)
          `
        }
      })
    },
  }
}
