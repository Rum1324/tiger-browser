import { z } from 'zod'
import { E5Embedder } from './e5-embedder'
import { type Embedder, HashEmbedder } from './embedder'

const optional = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()))

const Schema = z.object({
  /** `e5` = multilingual-e5-small q8 (production). `hash` = deterministic test embedder. */
  RETRIEVAL_EMBEDDER: z.enum(['e5', 'hash']).default('e5'),
  /** Directory the embedding model is cached in. */
  RETRIEVAL_MODEL_CACHE_DIR: optional,
  /** Spaces whose current items fit in this many estimated tokens are injected whole. */
  RETRIEVAL_WHOLE_SPACE_MAX_TOKENS: z.coerce.number().int().min(0).default(40_000),
  /** Weight of the keyword leg relative to the vector leg (1.0) in reciprocal rank fusion. */
  RETRIEVAL_KEYWORD_WEIGHT: z.coerce.number().min(0).max(4).default(0.5),
})

export interface RetrievalConfig {
  embedder: 'e5' | 'hash'
  modelCacheDir: string | null
  wholeSpaceMaxTokens: number
  keywordWeight: number
}

/** Retrieval settings from the environment; throws with variable names only, never values. */
export function loadRetrievalConfig(
  env: Record<string, string | undefined> = process.env,
): RetrievalConfig {
  const parsed = Schema.safeParse(env)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new Error(`invalid retrieval configuration\n${lines.join('\n')}`)
  }
  const c = parsed.data
  return {
    embedder: c.RETRIEVAL_EMBEDDER,
    modelCacheDir: c.RETRIEVAL_MODEL_CACHE_DIR ?? null,
    wholeSpaceMaxTokens: c.RETRIEVAL_WHOLE_SPACE_MAX_TOKENS,
    keywordWeight: c.RETRIEVAL_KEYWORD_WEIGHT,
  }
}

export function createEmbedder(config: RetrievalConfig): Embedder {
  if (config.embedder === 'hash') return new HashEmbedder()
  return new E5Embedder(config.modelCacheDir ? { cacheDir: config.modelCacheDir } : {})
}
