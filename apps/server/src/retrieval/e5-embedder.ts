import { homedir } from 'node:os'
import { join } from 'node:path'
import { EMBEDDING_DIMENSIONS, type Embedder } from './embedder'

export const E5_MODEL = 'Xenova/multilingual-e5-small'

export interface E5Options {
  /** Where model files are cached; downloaded on first use. */
  cacheDir?: string
  batchSize?: number
}

export function defaultModelCacheDir(): string {
  return join(homedir(), '.cache', 'tiger', 'models')
}

type Extractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>

/**
 * multilingual-e5-small, q8, through @huggingface/transformers (ONNX runtime, CPU). The model loads on
 * the first call and is shared afterwards; a failed load is not cached, so the next call retries.
 * Calls are serialised: one batch runs at a time so memory stays at one model's working set.
 */
export class E5Embedder implements Embedder {
  readonly id = `${E5_MODEL}:q8`
  private extractor: Promise<Extractor> | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private readonly cacheDir: string
  private readonly batchSize: number

  constructor(options: E5Options = {}) {
    this.cacheDir = options.cacheDir ?? defaultModelCacheDir()
    this.batchSize = options.batchSize ?? 16
  }

  embedPassages(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    return this.embed(
      texts.map((t) => `passage: ${t}`),
      signal,
    )
  }

  embedQueries(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    return this.embed(
      texts.map((t) => `query: ${t}`),
      signal,
    )
  }

  private load(): Promise<Extractor> {
    if (!this.extractor) {
      const loading = (async () => {
        const { pipeline } = await import('@huggingface/transformers')
        const make = pipeline as unknown as (
          task: string,
          model: string,
          options: { dtype: string; cache_dir: string },
        ) => Promise<Extractor>
        return make('feature-extraction', E5_MODEL, { dtype: 'q8', cache_dir: this.cacheDir })
      })()
      loading.catch(() => {
        if (this.extractor === loading) this.extractor = null
      })
      this.extractor = loading
    }
    return this.extractor
  }

  private embed(prefixed: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    const run = async () => {
      const extractor = await this.load()
      const out: Float32Array[] = []
      for (let i = 0; i < prefixed.length; i += this.batchSize) {
        signal?.throwIfAborted()
        const batch = prefixed.slice(i, i + this.batchSize)
        const res = await extractor(batch, { pooling: 'mean', normalize: true })
        const dim = res.dims[1]
        if (dim !== EMBEDDING_DIMENSIONS) {
          throw new Error(
            `embedding model returned ${dim} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
          )
        }
        for (let j = 0; j < batch.length; j++) {
          out.push(Float32Array.from(res.data.subarray(j * dim, (j + 1) * dim)))
        }
      }
      return out
    }
    const result = this.chain.then(run, run)
    this.chain = result.catch(() => {})
    return result
  }
}
