import type { Sql } from '../db/sql'
import type { Indexer, Retriever } from '../seams'
import { createEmbedder, loadRetrievalConfig, type RetrievalConfig } from './config'
import { type ContextBuilder, createContextBuilder } from './context'
import type { Embedder } from './embedder'
import { createIndexer } from './indexer'
import { createRetriever } from './search'

export { type Chunk, type ChunkOptions, chunkMarkdown, estimateTokens } from './chunker'
export { createEmbedder, loadRetrievalConfig, type RetrievalConfig } from './config'
export {
  type BuiltContext,
  type ContextBuilder,
  type ContextBuilderOptions,
  type ContextMode,
  type ContextSource,
  createContextBuilder,
  renderContext,
} from './context'
export { E5Embedder } from './e5-embedder'
export { EMBEDDING_DIMENSIONS, type Embedder, HashEmbedder, toVectorLiteral } from './embedder'
export { chunkEmbedText, createIndexer } from './indexer'
export { createRetriever, fuse, type HybridOptions, keywordTerms } from './search'

export interface Retrieval {
  embedder: Embedder
  indexer: Indexer
  retriever: Retriever
  contextBuilder: ContextBuilder
}

/** The retrieval parts wired to one database and one embedder; pass `indexer` and `retriever` to buildApp. */
export function createRetrieval(deps: {
  sql: Sql
  config?: RetrievalConfig
  embedder?: Embedder
}): Retrieval {
  const config = deps.config ?? loadRetrievalConfig()
  const embedder = deps.embedder ?? createEmbedder(config)
  const retriever = createRetriever({
    sql: deps.sql,
    embedder,
    options: { keywordWeight: config.keywordWeight },
  })
  return {
    embedder,
    indexer: createIndexer({ sql: deps.sql, embedder }),
    retriever,
    contextBuilder: createContextBuilder({
      sql: deps.sql,
      retriever,
      options: { wholeSpaceMaxTokens: config.wholeSpaceMaxTokens },
    }),
  }
}
