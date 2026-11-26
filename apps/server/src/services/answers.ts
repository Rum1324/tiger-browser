import { Citation, type Message, type ModelRef, type Thread, type User } from '@tiger/shared'
import type { AppContext } from '../context'
import type { Sql } from '../db/sql'
import { AnswerError, type AttachmentContent, type CitationInput } from '../seams'
import { getMessage, type StoredCitation } from './rows'
import { recordUsage } from './usage'

const StoredCitationSchema = Citation.omit({ available: true })

export interface RunAnswerParams {
  thread: Thread
  route: { spaceId: string; visibility: 'private' | 'space'; ownerId: string }
  user: User
  model: ModelRef
  history: Message[]
  message: Message
  attachments: AttachmentContent[]
  assistantMessageId: string
}

/**
 * Keep only citations of items in this Space. A cited item that was unshared meanwhile keeps its chip
 * (the audit tombstone proves it belonged here) but loses its quote. Anything else is dropped, so an
 * answerer bug cannot point a chip at another Space's item.
 */
export async function settleCitations(
  sql: Sql,
  spaceId: string,
  input: CitationInput[],
): Promise<{ stored: StoredCitation[]; live: Set<string> }> {
  const parsed: StoredCitation[] = []
  for (const c of input) {
    const r = StoredCitationSchema.safeParse({ ...c, quote: (c.quote ?? '').slice(0, 600) })
    if (r.success) parsed.push(r.data)
  }
  const ids = [...new Set(parsed.map((c) => c.itemId))]
  if (ids.length === 0) return { stored: [], live: new Set() }
  const live = new Set(
    (
      await sql<{ id: string }[]>`
        select id from items where space_id = ${spaceId} and id = any(${ids}::uuid[])
      `
    ).map((r) => r.id),
  )
  const tombstoned = new Set(
    (
      await sql<{ target_id: string }[]>`
        select target_id from audit_events
        where space_id = ${spaceId} and action = 'item.unshared' and target_id = any(${ids}::text[])
      `
    ).map((r) => r.target_id),
  )
  const stored = parsed
    .filter((c) => live.has(c.itemId) || tombstoned.has(c.itemId))
    .map((c) => (live.has(c.itemId) ? c : { ...c, quote: '' }))
  return { stored, live }
}

/** Runs the Answerer in the background and forwards its stream to the thread's audience. */
export function runAnswer(ctx: AppContext, p: RunAnswerParams): void {
  const { sql, hub } = ctx
  const controller = new AbortController()
  const onShutdown = () => controller.abort()
  ctx.shutdown.signal.addEventListener('abort', onShutdown, { once: true })
  let running = ctx.runningAnswers.get(p.thread.id)
  if (!running) {
    running = new Set()
    ctx.runningAnswers.set(p.thread.id, running)
  }
  running.add(controller)

  const spaceId = p.route.spaceId
  const threadId = p.thread.id
  const messageId = p.assistantMessageId
  let seq = 0
  let streamed = ''
  let settled = false
  // Sources are validated asynchronously; chaining keeps them in emission order.
  let sourcesChain: Promise<void> = Promise.resolve()

  const emit = (
    event: { type: 'delta'; text: string } | { type: 'sources'; citations: CitationInput[] },
  ) => {
    if (settled) return
    if (event.type === 'delta') {
      if (!event.text) return
      streamed += event.text
      hub.publishForThread(p.route, {
        type: 'message.delta',
        spaceId,
        threadId,
        messageId,
        seq: seq++,
        text: event.text,
      })
      return
    }
    const citations = event.citations
    sourcesChain = sourcesChain.then(async () => {
      const { stored, live } = await settleCitations(sql, spaceId, citations)
      if (settled) return
      hub.publishForThread(p.route, {
        type: 'message.sources',
        spaceId,
        threadId,
        messageId,
        citations: stored.map((c) => ({ ...c, available: live.has(c.itemId) })),
      })
    })
  }

  ctx.background.run(`answer ${messageId}`, async () => {
    try {
      const result = await ctx.answerer.answer({
        thread: p.thread,
        spaceId,
        user: p.user,
        model: p.model,
        history: p.history,
        message: p.message,
        attachments: p.attachments,
        assistantMessageId: messageId,
        emit,
        signal: controller.signal,
      })
      await sourcesChain.catch(() => {})
      settled = true
      if (controller.signal.aborted) throw new AnswerError('ai_aborted', 'The answer was stopped')
      const { stored } = await settleCitations(sql, spaceId, result.citations)
      const usage = {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        cacheWriteTokens: result.usage.cacheWriteTokens ?? 0,
      }
      const written = await sql.begin(async (tx) => {
        const rows = await tx`
          update messages set content = ${result.content}, citations = ${tx.json(stored)},
                              status = 'complete', error_code = null, usage = ${tx.json(usage)}
          where id = ${messageId}
          returning id
        `
        await recordUsage(tx, {
          spaceId,
          userId: p.user.id,
          messageId,
          provider: p.model.provider,
          model: p.model.id,
          usage: result.usage,
        })
        return rows.length > 0
      })
      if (!written) return
      const message = await getMessage(sql, messageId)
      hub.publishForThread(p.route, { type: 'message.completed', spaceId, message, usage })
    } catch (err) {
      settled = true
      await sourcesChain.catch(() => {})
      const code =
        err instanceof AnswerError
          ? err.code
          : controller.signal.aborted
            ? 'ai_aborted'
            : 'ai_failed'
      const text =
        err instanceof AnswerError ? err.message : 'The AI provider failed to produce an answer'
      if (!(err instanceof AnswerError)) ctx.log.error({ err, messageId }, 'answerer failed')
      const spent = err instanceof AnswerError ? err.usage : undefined
      await sql.begin(async (tx) => {
        await tx`
          update messages set status = 'error', error_code = ${code}, content = ${streamed}
          where id = ${messageId}
        `
        // Tokens spent before a failure still count against the budget.
        if (spent) {
          await recordUsage(tx, {
            spaceId,
            userId: p.user.id,
            messageId,
            provider: p.model.provider,
            model: p.model.id,
            usage: spent,
          })
        }
      })
      hub.publishForThread(p.route, {
        type: 'message.failed',
        spaceId,
        threadId,
        messageId,
        code,
        message: text,
      })
    } finally {
      ctx.shutdown.signal.removeEventListener('abort', onShutdown)
      running.delete(controller)
      if (running.size === 0) ctx.runningAnswers.delete(threadId)
    }
  })
}
