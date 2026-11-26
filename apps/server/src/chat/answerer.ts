import type { ChatErrorCode, ChatRequest, ChatUsage, Router } from '@tiger/llm'
import type { MessageErrorCode, ModelRef } from '@tiger/shared'
import type { Sql } from '../db/sql'
import { estimateTokens } from '../retrieval/chunker'
import type { BuiltContext, ContextBuilder } from '../retrieval/context'
import { AnswerError, type Answerer, type AnswerInput, type AnswerUsage } from '../seams'
import { budgetExceeded, getSpaceUsage, reserveBudget } from '../services/usage'
import { finalizeAnswer, previewCitations } from './citations'
import { assemblePrompt } from './prompt'

/** Stable error codes for the assistant message; the UI keys its copy on these. */
export function answerErrorCode(code: ChatErrorCode): MessageErrorCode {
  switch (code) {
    case 'aborted':
      return 'ai_aborted'
    case 'unknown_model':
    case 'model_unavailable':
      return 'model_unavailable'
    case 'auth':
    case 'quota_exceeded':
      return 'ai_unavailable'
    case 'rate_limited':
    case 'overloaded':
      return 'ai_busy'
    case 'context_too_long':
      return 'ai_context_too_long'
    case 'timeout':
    case 'network':
      return 'ai_timeout'
    default:
      return 'ai_failed'
  }
}

/** What one answer sent and got, for logging and for tests that inspect the assembled prompt. */
export interface AnswerTrace {
  input: AnswerInput
  request: ChatRequest
  context: BuiltContext
}

export interface AnswererDeps {
  sql: Sql
  router: Router
  contextBuilder: ContextBuilder
  /** Called after a successful answer to name a new thread; must not block. */
  onFirstExchange?: (job: { input: AnswerInput; content: string }) => void
  /** Observes each request just before it is sent. */
  onRequest?: (trace: AnswerTrace) => void
  now?: () => Date
}

const sameModel = (a: ModelRef, b: ModelRef) => a.provider === b.provider && a.id === b.id

function toAnswerUsage(router: Router, model: ModelRef, u: ChatUsage, at: Date): AnswerUsage {
  return {
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cachedInputTokens: u.cachedInputTokens,
    cacheWriteTokens: u.cacheWriteTokens,
    costUsd: router.costUsd(model, u, at),
  }
}

/** Output tokens held against the budget for an answer whose request sets no maximum. */
const DEFAULT_OUTPUT_RESERVE = 1024

/** A provider that ended without usage still spent tokens; count an estimate against the budget. */
function estimatedUsage(request: ChatRequest, output: string): ChatUsage {
  const input =
    estimateTokens(request.system) +
    estimateTokens(request.context ?? '') +
    request.messages.reduce((n, m) => n + estimateTokens(m.content), 0)
  return {
    inputTokens: input,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: estimateTokens(output),
  }
}

/**
 * The real Answerer: Space sources from the ContextBuilder go into the cached context, the asking
 * member's private pages after it, then the trimmed history and the question. Deltas are forwarded
 * as they arrive; markers are validated against the source list once the stream ends.
 */
export function createAnswerer(deps: AnswererDeps): Answerer {
  const { sql, router, contextBuilder } = deps
  const now = deps.now ?? (() => new Date())

  return {
    async answer(input) {
      const { spaceId, model, signal } = input
      // postMessage checked too, but answers started together can overrun; check again right here.
      if (budgetExceeded(await getSpaceUsage(sql, spaceId))) {
        throw new AnswerError('budget_exceeded', "This Space has used this month's AI budget")
      }
      const info = router.listModels().find((m) => sameModel(m, model))
      if (!info?.available) {
        throw new AnswerError('model_unavailable', 'That model is not available on this server')
      }

      const built = await contextBuilder.build({ spaceId, question: input.message.content, signal })
      if (signal.aborted) throw new AnswerError('ai_aborted', 'The answer was stopped')
      const prompt = assemblePrompt({
        sources: built.sources,
        attachments: input.attachments,
        history: input.history,
        question: input.message,
        visibility: input.thread.visibility,
        contextWindow: info.contextWindow,
      })
      const request: ChatRequest = {
        model,
        system: prompt.system,
        ...(prompt.context ? { context: prompt.context } : {}),
        // Whole-space context repeats across questions; retrieved passages almost never do.
        cacheContext: built.mode === 'whole-space',
        messages: prompt.messages,
        cacheKey: `space:${spaceId}`,
        signal,
      }
      // Hold this answer's expected cost before calling the provider, so answers started together
      // cannot all pass the check above. Released when the answer settles (services/answers.ts).
      const expected =
        estimatedUsage(request, '').inputTokens +
        (request.maxOutputTokens ?? DEFAULT_OUTPUT_RESERVE)
      const reserved = await reserveBudget(sql, {
        spaceId,
        messageId: input.assistantMessageId,
        tokens: expected,
      })
      if (!reserved) {
        throw new AnswerError('budget_exceeded', "This Space has used this month's AI budget")
      }
      deps.onRequest?.({ input, request, context: built })

      // The UI can resolve [n] chips while the text streams.
      if (built.sources.length > 0) {
        input.emit({ type: 'sources', citations: previewCitations(built.sources) })
      }

      let text = ''
      let usage: ChatUsage | null = null
      let stopReason: string | null = null
      const spent = () =>
        toAnswerUsage(router, model, usage ?? estimatedUsage(request, text), now())

      for await (const ev of router.stream(request)) {
        if (signal.aborted) {
          throw new AnswerError('ai_aborted', 'The answer was stopped', spent())
        }
        if (ev.type === 'text') {
          text += ev.delta
          input.emit({ type: 'delta', text: ev.delta })
        } else if (ev.type === 'usage') {
          usage = ev
        } else if (ev.type === 'done') {
          stopReason = ev.stopReason
        } else {
          throw new AnswerError(answerErrorCode(ev.code), ev.message, spent())
        }
      }
      if (signal.aborted) throw new AnswerError('ai_aborted', 'The answer was stopped', spent())
      if (text.trim() === '') {
        const refused = stopReason === 'refusal' || stopReason === 'filtered'
        throw new AnswerError(
          refused ? 'ai_refused' : 'ai_failed',
          refused ? 'The model declined to answer' : 'The model returned an empty answer',
          spent(),
        )
      }

      const final = finalizeAnswer(
        text,
        built.sources,
        prompt.privateSources.map((s) => s.label),
      )
      if (input.history.length === 0) deps.onFirstExchange?.({ input, content: final.content })
      return { content: final.content, citations: final.citations, usage: spent() }
    },
  }
}
