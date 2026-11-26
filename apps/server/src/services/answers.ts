import { Citation, type Message, type ModelRef, type Thread, type User } from '@tiger/shared'
import type { AppContext, RunningAnswer } from '../context'
import type { Sql, TxSql } from '../db/sql'
import { AnswerError, type AttachmentContent, type CitationInput } from '../seams'
import { getMessage, type StoredCitation } from './rows'
import { recordUsage, releaseReservation } from './usage'

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
 *
 * Inside the transaction that stores the citations, pass `lock`: the cited item rows are then held
 * FOR SHARE until commit, so an unshare either committed first (its item is missing here and the
 * quote is emptied) or waits for this commit and then scrubs the stored row itself.
 */
export async function settleCitations(
  sql: Sql | TxSql,
  spaceId: string,
  input: CitationInput[],
  lock = false,
): Promise<{ stored: StoredCitation[]; live: Set<string> }> {
  const parsed: StoredCitation[] = []
  for (const c of input) {
    const r = StoredCitationSchema.safeParse({ ...c, quote: (c.quote ?? '').slice(0, 600) })
    if (r.success) parsed.push(r.data)
  }
  const ids = [...new Set(parsed.map((c) => c.itemId))]
  if (ids.length === 0) return { stored: [], live: new Set() }
  const live = new Set(
    (lock
      ? await sql<{ id: string }[]>`
          select id from items where space_id = ${spaceId} and id = any(${ids}::uuid[])
          order by id for share
        `
      : await sql<{ id: string }[]>`
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

  const spaceId = p.route.spaceId
  const threadId = p.thread.id
  const messageId = p.assistantMessageId
  let finish!: () => void
  const live: RunningAnswer = {
    messageId,
    threadId,
    spaceId,
    askerId: p.user.id,
    controller,
    text: '',
    seq: 0,
    citations: null,
    done: new Promise<void>((resolve) => {
      finish = resolve
    }),
  }
  ctx.runningAnswers.set(messageId, live)
  let settled = false
  // Sources are validated asynchronously; chaining keeps them in emission order.
  let sourcesChain: Promise<void> = Promise.resolve()

  const emit = (
    event: { type: 'delta'; text: string } | { type: 'sources'; citations: CitationInput[] },
  ) => {
    // Nothing is forwarded once the answer is stopped, so the kept text is what members saw.
    if (settled || controller.signal.aborted) return
    if (event.type === 'delta') {
      if (!event.text) return
      live.text += event.text
      hub.publishForThread(p.route, {
        type: 'message.delta',
        spaceId,
        threadId,
        messageId,
        seq: live.seq++,
        text: event.text,
      })
      return
    }
    const citations = event.citations
    sourcesChain = sourcesChain.then(async () => {
      const { stored, live: present } = await settleCitations(sql, spaceId, citations)
      if (settled || controller.signal.aborted) return
      live.citations = stored.map((c) => ({ ...c, available: present.has(c.itemId) }))
      hub.publishForThread(p.route, {
        type: 'message.sources',
        spaceId,
        threadId,
        messageId,
        citations: live.citations,
      })
    })
  }

  ctx.background.run(`answer ${messageId}`, async () => {
    try {
      // A stop that arrived before this answer was registered has already settled the row.
      const [row] = await sql<
        { status: string }[]
      >`select status from messages where id = ${messageId}`
      if (row?.status !== 'streaming') return
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
      const usage = {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        cacheWriteTokens: result.usage.cacheWriteTokens ?? 0,
      }
      const written = await sql.begin(async (tx) => {
        const { stored } = await settleCitations(tx, spaceId, result.citations, true)
        const rows = await tx`
          update messages set content = ${result.content}, citations = ${tx.json(stored)},
                              status = 'complete', error_code = null, usage = ${tx.json(usage)}
          where id = ${messageId} and status = 'streaming'
          returning id
        `
        await releaseReservation(tx, messageId)
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
      // A stop always reads as ai_aborted, whatever the provider threw while being cut off.
      const aborted = controller.signal.aborted
      const code = aborted ? 'ai_aborted' : err instanceof AnswerError ? err.code : 'ai_failed'
      const text = aborted
        ? 'The answer was stopped'
        : err instanceof AnswerError
          ? err.message
          : 'The AI provider failed to produce an answer'
      if (!aborted && !(err instanceof AnswerError)) {
        ctx.log.error({ err, messageId }, 'answerer failed')
      }
      const spent = err instanceof AnswerError ? err.usage : undefined
      // Keep what members already saw: the streamed text and the sources its [n] markers point to,
      // minus the quotes of items unshared since (invariant 3).
      const shown: CitationInput[] = (live.citations ?? []).map(
        ({ available: _available, ...c }) => c,
      )
      const written = await sql.begin(async (tx) => {
        const { stored: keptCitations } = await settleCitations(tx, spaceId, shown, true)
        const rows = await tx`
          update messages set status = 'error', error_code = ${code}, content = ${live.text},
                              citations = ${tx.json(keptCitations)}
          where id = ${messageId} and status = 'streaming'
          returning id
        `
        await releaseReservation(tx, messageId)
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
        return rows.length > 0
      })
      // Already settled elsewhere (a stop before the answer started, or the thread is gone).
      if (!written) return
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
      ctx.runningAnswers.delete(messageId)
      finish()
    }
  })
}
