import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Embedder } from '../../src/retrieval'
import { createRetrieval, EMBEDDING_DIMENSIONS, HashEmbedder } from '../../src/retrieval'
import { type Harness, page, startHarness } from '../helpers/harness'

export { page }

/** Shared by every test that loads the real model, so it is downloaded once per machine. */
export const MODEL_CACHE_DIR =
  process.env.TIGER_TEST_MODEL_CACHE ?? join(tmpdir(), 'tiger-test-models')

export async function startRetrievalHarness(embedder: Embedder = new HashEmbedder()) {
  let retrieval = null as ReturnType<typeof createRetrieval> | null
  const h = await startHarness({
    // The harness creates the db; the seams are filled in right after through lazy delegates.
    indexer: { index: (i) => must(retrieval).indexer.index(i) },
    retriever: { search: (i) => must(retrieval).retriever.search(i) },
  })
  retrieval = createRetrieval({ sql: h.sql, embedder })
  return { h, retrieval }
}

function must<T>(v: T | null): T {
  if (!v) throw new Error('retrieval not ready')
  return v
}

export async function share(
  h: Harness,
  token: string,
  spaceId: string,
  url: string,
  title: string,
  markdown: string,
) {
  const r = await h.ok(
    'shareItem',
    { params: { spaceId }, body: { page: page(url, markdown, title) } },
    token,
  )
  await h.settle()
  // The share response is taken before indexing; read the settled item.
  const settled = await h.ok('getItem', { params: { itemId: r.item.id } }, token)
  return settled
}

/** Every vector identical: the vector leg cannot tell chunks apart, so only keyword evidence can. */
export class BlindEmbedder implements Embedder {
  readonly id = 'blind'
  private readonly v = (() => {
    const a = new Float32Array(EMBEDDING_DIMENSIONS)
    a[0] = 1
    return a
  })()
  async embedPassages(texts: string[]) {
    return texts.map(() => this.v)
  }
  async embedQueries(texts: string[]) {
    return texts.map(() => this.v)
  }
}
