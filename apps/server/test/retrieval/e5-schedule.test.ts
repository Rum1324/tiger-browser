import { describe, expect, it } from 'vitest'
import { EMBEDDING_DIMENSIONS } from '../../src/retrieval'
import { E5Embedder, type Extractor } from '../../src/retrieval/e5-embedder'

/** A stand-in for the model: a fixed cost per batch, and a log of what ran in which order. */
function fakeModel(msPerBatch: number) {
  const ran: string[] = []
  const extractor: Extractor = async (texts) => {
    ran.push(texts[0]?.startsWith('query: ') ? 'q' : 'p')
    await new Promise((r) => setTimeout(r, msPerBatch))
    return {
      data: new Float32Array(texts.length * EMBEDDING_DIMENSIONS).fill(0.05),
      dims: [texts.length, EMBEDDING_DIMENSIONS],
    }
  }
  return { ran, loadExtractor: async () => extractor }
}

describe('E5Embedder scheduling', () => {
  it('a query issued during a large indexing job waits for one batch, not the whole job', async () => {
    const model = fakeModel(40)
    const e = new E5Embedder({ batchSize: 16, loadExtractor: model.loadExtractor })
    // 1,600 passages = 100 batches = about 4 s of model time.
    const indexing = e.embedPassages(Array.from({ length: 1600 }, (_, i) => `chunk ${i}`))
    await new Promise((r) => setTimeout(r, 50))
    const t0 = Date.now()
    const [q] = await e.embedQueries(['what is the plan?'])
    const waited = Date.now() - t0
    expect(q).toHaveLength(EMBEDDING_DIMENSIONS)
    // At most the batch in flight plus the query's own batch, with slack for a loaded machine.
    expect(waited).toBeLessThan(400)
    const vectors = await indexing
    expect(vectors).toHaveLength(1600)
    expect(model.ran.filter((x) => x === 'q')).toHaveLength(1)
    expect(model.ran.indexOf('q')).toBeLessThan(5)
  })

  it('two indexing jobs take turns batch by batch', async () => {
    const model = fakeModel(5)
    const e = new E5Embedder({ batchSize: 2, loadExtractor: model.loadExtractor })
    const order: string[] = []
    const a = e.embedPassages(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']).then(() => order.push('a'))
    const b = e.embedPassages(['b1', 'b2']).then(() => order.push('b'))
    await Promise.all([a, b])
    // The short job finishes first although it was queued second.
    expect(order).toEqual(['b', 'a'])
  })

  it('a call aborted while queued leaves the queue at once; one aborted before never queues', async () => {
    const model = fakeModel(40)
    const e = new E5Embedder({ batchSize: 16, loadExtractor: model.loadExtractor })
    const indexing = e.embedPassages(Array.from({ length: 320 }, (_, i) => `chunk ${i}`))
    const ctl = new AbortController()
    const waiting = e.embedPassages(['late'], ctl.signal)
    await new Promise((r) => setTimeout(r, 20))
    const t0 = Date.now()
    ctl.abort(new Error('stopped'))
    await expect(waiting).rejects.toThrow('stopped')
    expect(Date.now() - t0).toBeLessThan(30)
    await expect(e.embedQueries(['x'], ctl.signal)).rejects.toThrow('stopped')
    await indexing
    expect(e.queued).toEqual({ query: 0, passage: 0 })
  })
})
