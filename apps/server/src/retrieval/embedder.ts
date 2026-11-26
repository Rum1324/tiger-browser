import { createHash } from 'node:crypto'

/** Dimension of the `chunks.embedding` column. Changing the model to another size needs a migration. */
export const EMBEDDING_DIMENSIONS = 384

/**
 * Turns text into unit-length vectors. Queries and passages are embedded differently (e5 uses the
 * "query: " and "passage: " prefixes), so the two entry points are separate.
 */
export interface Embedder {
  /** Stable name stored nowhere but useful in logs and tests. */
  readonly id: string
  embedPassages(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>
  embedQueries(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>
}

/** pgvector text literal for one vector. */
export function toVectorLiteral(v: ArrayLike<number>): string {
  return `[${Array.from(v).join(',')}]`
}

/**
 * Deterministic embedder for tests: hashed character bigrams plus word tokens, signed, L2-normalised.
 * Texts that share words or Japanese bigrams get similar vectors, so retrieval tests are meaningful
 * for same-language queries; it cannot match across languages (the real model has its own test).
 */
export class HashEmbedder implements Embedder {
  readonly id = 'hash-384'

  async embedPassages(texts: string[]): Promise<Float32Array[]> {
    return texts.map(hashEmbed)
  }

  async embedQueries(texts: string[]): Promise<Float32Array[]> {
    return texts.map(hashEmbed)
  }
}

function hashEmbed(text: string): Float32Array {
  const v = new Float32Array(EMBEDDING_DIMENSIONS)
  const s = text.normalize('NFKC').toLowerCase()
  const add = (feature: string, weight: number) => {
    const h = createHash('sha256').update(feature).digest()
    const idx = h.readUInt32BE(0) % EMBEDDING_DIMENSIONS
    v[idx] = (v[idx] ?? 0) + ((h[4] as number) & 1 ? weight : -weight)
  }
  const chars = Array.from(s).filter((c) => /[\p{L}\p{N}]/u.test(c))
  for (let i = 0; i + 1 < chars.length; i++) add(`b:${chars[i]}${chars[i + 1]}`, 1)
  for (const w of s.match(/[a-z0-9]+/g) ?? []) add(`w:${w}`, 2)
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm)
  if (norm === 0) v[0] = 1
  else for (let i = 0; i < v.length; i++) v[i] = (v[i] as number) / norm
  return v
}
