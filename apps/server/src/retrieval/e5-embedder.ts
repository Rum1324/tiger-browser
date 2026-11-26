import { homedir } from 'node:os'
import { join } from 'node:path'
import { EMBEDDING_DIMENSIONS, type Embedder } from './embedder'

export const E5_MODEL = 'Xenova/multilingual-e5-small'

export interface E5Options {
  /** Where model files are cached; downloaded on first use. */
  cacheDir?: string
  batchSize?: number
  /** Replaces the model loader; tests pass a fake extractor with a known cost per batch. */
  loadExtractor?: () => Promise<Extractor>
}

export function defaultModelCacheDir(): string {
  return join(homedir(), '.cache', 'tiger', 'models')
}

export type Extractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>

type Lane = 'query' | 'passage'

interface QueuedBatch {
  run: () => Promise<void>
  signal: AbortSignal | undefined
  reject: (err: unknown) => void
  onAbort: () => void
}

/**
 * multilingual-e5-small, q8, through @huggingface/transformers (ONNX runtime, CPU). The model loads on
 * the first call and is shared afterwards; a failed load is not cached, so the next call retries.
 *
 * One batch runs at a time so memory stays at one model's working set, but calls are scheduled per
 * batch, not per call: query batches (a question waiting for its answer) always run before passage
 * batches (background indexing), and each call queues its next batch only after the previous one ran,
 * so concurrent indexing jobs take turns instead of one large document holding the model for minutes.
 * A call whose signal aborts while it waits leaves the queue at once.
 */
export class E5Embedder implements Embedder {
  readonly id = `${E5_MODEL}:q8`
  private extractor: Promise<Extractor> | null = null
  private readonly cacheDir: string
  private readonly batchSize: number
  private readonly loadExtractor: (() => Promise<Extractor>) | undefined
  private readonly lanes: Record<Lane, QueuedBatch[]> = { query: [], passage: [] }
  private running = false

  constructor(options: E5Options = {}) {
    this.cacheDir = options.cacheDir ?? defaultModelCacheDir()
    this.batchSize = options.batchSize ?? 16
    this.loadExtractor = options.loadExtractor
  }

  embedPassages(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    return this.embed(
      'passage',
      texts.map((t) => `passage: ${t}`),
      signal,
    )
  }

  embedQueries(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    return this.embed(
      'query',
      texts.map((t) => `query: ${t}`),
      signal,
    )
  }

  /** Batches waiting to run, by lane (for tests and logs). */
  get queued(): { query: number; passage: number } {
    return { query: this.lanes.query.length, passage: this.lanes.passage.length }
  }

  private load(): Promise<Extractor> {
    if (!this.extractor) {
      const loading = this.loadExtractor
        ? this.loadExtractor()
        : (async () => {
            const { pipeline } = await import('@huggingface/transformers')
            const make = pipeline as unknown as (
              task: string,
              model: string,
              options: { dtype: string; cache_dir: string },
            ) => Promise<Extractor>
            return make('feature-extraction', E5_MODEL, {
              dtype: 'q8',
              cache_dir: this.cacheDir,
            })
          })()
      loading.catch(() => {
        if (this.extractor === loading) this.extractor = null
      })
      this.extractor = loading
    }
    return this.extractor
  }

  /** Runs `work` when the model is free and no batch of a higher-priority lane is waiting. */
  private schedule<T>(
    lane: Lane,
    signal: AbortSignal | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason)
        return
      }
      const entry: QueuedBatch = {
        signal,
        reject,
        onAbort: () => {
          const queue = this.lanes[lane]
          const at = queue.indexOf(entry)
          if (at >= 0) {
            queue.splice(at, 1)
            reject(signal?.reason)
          }
        },
        run: async () => {
          signal?.removeEventListener('abort', entry.onAbort)
          try {
            signal?.throwIfAborted()
            resolve(await work())
          } catch (err) {
            reject(err)
          }
        },
      }
      signal?.addEventListener('abort', entry.onAbort, { once: true })
      this.lanes[lane].push(entry)
      this.pump()
    })
  }

  private pump(): void {
    if (this.running) return
    const next = this.lanes.query.shift() ?? this.lanes.passage.shift()
    if (!next) return
    this.running = true
    void next.run().finally(() => {
      this.running = false
      this.pump()
    })
  }

  private async embed(
    lane: Lane,
    prefixed: string[],
    signal?: AbortSignal,
  ): Promise<Float32Array[]> {
    signal?.throwIfAborted()
    const out: Float32Array[] = []
    for (let i = 0; i < prefixed.length; i += this.batchSize) {
      const batch = prefixed.slice(i, i + this.batchSize)
      const vectors = await this.schedule(lane, signal, async () => {
        const extractor = await this.load()
        const res = await extractor(batch, { pooling: 'mean', normalize: true })
        const dim = res.dims[1]
        if (dim !== EMBEDDING_DIMENSIONS) {
          throw new Error(
            `embedding model returned ${dim} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
          )
        }
        const part: Float32Array[] = []
        for (let j = 0; j < batch.length; j++) {
          part.push(Float32Array.from(res.data.subarray(j * dim, (j + 1) * dim)))
        }
        return part
      })
      out.push(...vectors)
    }
    return out
  }
}
