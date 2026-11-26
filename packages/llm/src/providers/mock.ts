import type { CatalogModel } from '../catalog'
import type { ChatEvent, ChatRequest } from '../types'
import type { ChatProvider } from './types'

export interface MockOptions {
  /** Pause between chunks; lets a UI show streaming during offline development. */
  chunkDelayMs?: number
  chunkSize?: number
}

/** A user message containing this marker makes the mock fail, to exercise error paths offline. */
export const MOCK_ERROR_MARKER = '[mock:error]'

const SOURCE_LINE = /^\[(\d{1,3})\][ \t]*(.*)$/gm

/** Numbered sources found in the context, in order, first occurrence of each number. */
export function findNumberedSources(context: string): { n: number; text: string }[] {
  const out: { n: number; text: string }[] = []
  const seen = new Set<number>()
  for (const m of context.matchAll(SOURCE_LINE)) {
    const n = Number(m[1])
    if (seen.has(n)) continue
    seen.add(n)
    out.push({ n, text: (m[2] ?? '').trim() })
  }
  return out
}

const approxTokens = (s: string) => Math.ceil(s.length / 4)

function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return `${s.length}:${h}`
}

export class MockProvider implements ChatProvider {
  private readonly warm = new Set<string>()
  private readonly chunkDelayMs: number
  private readonly chunkSize: number

  constructor(opts: MockOptions = {}) {
    this.chunkDelayMs = opts.chunkDelayMs ?? 0
    this.chunkSize = opts.chunkSize ?? 16
  }

  private compose(req: ChatRequest): string {
    const last = req.messages.at(-1)?.content.trim() ?? ''
    const sources = findNumberedSources(req.context ?? '').slice(0, 3)
    if (sources.length === 0)
      return `Mock answer to "${last.slice(0, 80)}". No sources were provided.`
    const cites = sources.map((s) => `${s.text.slice(0, 60) || 'Source'} [${s.n}]`).join(' ')
    return `Mock answer to "${last.slice(0, 80)}". From the shared context: ${cites}.`
  }

  async *stream(_model: CatalogModel, req: ChatRequest): AsyncGenerator<ChatEvent> {
    const aborted = (): ChatEvent => ({
      type: 'error',
      code: 'aborted',
      message: 'Request aborted',
      retryable: false,
    })
    if (req.signal?.aborted) return yield aborted()
    const last = req.messages.at(-1)?.content ?? ''
    if (last.includes(MOCK_ERROR_MARKER)) {
      return yield {
        type: 'error',
        code: 'provider_error',
        message: 'Mock failure requested',
        retryable: false,
      }
    }
    const text = this.compose(req)
    for (let i = 0; i < text.length; i += this.chunkSize) {
      if (this.chunkDelayMs > 0) await new Promise((r) => setTimeout(r, this.chunkDelayMs))
      if (req.signal?.aborted) return yield aborted()
      yield { type: 'text', delta: text.slice(i, i + this.chunkSize) }
    }

    // Behave like a caching provider: the first sight of a (key, context) pair writes the cache,
    // later ones read it. Lets the server's usage accounting be tested offline.
    const ctxTokens = approxTokens(req.context ?? '')
    const rest =
      approxTokens(req.system) + req.messages.reduce((n, m) => n + approxTokens(m.content), 0)
    let cached = 0
    let written = 0
    if (ctxTokens > 0) {
      const key = `${req.cacheKey ?? ''}|${hash(req.context ?? '')}`
      if (this.warm.has(key)) cached = ctxTokens
      else {
        this.warm.add(key)
        written = ctxTokens
      }
    }
    yield {
      type: 'usage',
      inputTokens: ctxTokens + rest,
      cachedInputTokens: cached,
      cacheWriteTokens: written,
      outputTokens: approxTokens(text),
    }
    yield { type: 'done', stopReason: 'end' }
  }
}
