import { describe, expect, it } from 'vitest'
import { createEmbedder, E5Embedder, HashEmbedder, loadRetrievalConfig } from '../../src/retrieval'

describe('retrieval configuration', () => {
  it('defaults to the real model with a 40k-token whole-Space threshold', () => {
    expect(loadRetrievalConfig({})).toEqual({
      embedder: 'e5',
      modelCacheDir: null,
      wholeSpaceMaxTokens: 40_000,
      keywordWeight: 0.5,
    })
  })

  it('selects the embedder, cache directory and thresholds from the environment', () => {
    const config = loadRetrievalConfig({
      RETRIEVAL_EMBEDDER: 'hash',
      RETRIEVAL_MODEL_CACHE_DIR: '/var/cache/models',
      RETRIEVAL_WHOLE_SPACE_MAX_TOKENS: '80000',
      RETRIEVAL_KEYWORD_WEIGHT: '0',
    })
    expect(config).toEqual({
      embedder: 'hash',
      modelCacheDir: '/var/cache/models',
      wholeSpaceMaxTokens: 80_000,
      keywordWeight: 0,
    })
    expect(createEmbedder(config)).toBeInstanceOf(HashEmbedder)
    expect(createEmbedder({ ...config, embedder: 'e5' })).toBeInstanceOf(E5Embedder)
  })

  it('names the variable but never the value when the configuration is wrong', () => {
    expect(() => loadRetrievalConfig({ RETRIEVAL_EMBEDDER: 'secret-value-123' })).toThrow(
      /RETRIEVAL_EMBEDDER/,
    )
    try {
      loadRetrievalConfig({ RETRIEVAL_EMBEDDER: 'secret-value-123' })
    } catch (err) {
      expect(String(err)).not.toContain('secret-value-123')
    }
  })
})
