import type {
  Message,
  MessageErrorCode,
  PostMessageBody,
  SpaceRole,
  Thread,
  ThreadVisibility,
  TokenUsage,
  User,
} from '@tiger/shared'
import type { AppContext } from '../context'
import type { Sql } from '../db/sql'
import { AppError, notFound } from '../errors'
import { newId } from '../ids'
import { requireMember, requireThreadAccess, type ThreadAccess } from './access'
import { runAnswer, settleCitations } from './answers'
import { appendAudit } from './audit'
import { assertCaptureAllowed } from './items'
import {
  getMessage,
  type StoredCitation,
  selectMessages,
  selectThreads,
  toMessages,
  toThread,
  userRef,
} from './rows'
import { budgetExceeded, getSpaceUsage } from './usage'

const DEFAULT_PAGE = 50
const HISTORY_LIMIT = 50

export async function getThread(sql: Sql, threadId: string): Promise<Thread> {
  const row = (await selectThreads(sql, sql`t.id = ${threadId}`))[0]
  if (!row) throw notFound('thread_not_found', 'Thread')
  return toThread(row)
}

const routing = (t: Thread | ThreadAccess) =>
  'owner' in t
    ? { spaceId: t.spaceId, visibility: t.visibility, ownerId: t.owner.id }
    : { spaceId: t.spaceId, visibility: t.visibility, ownerId: t.ownerId }

export async function listThreads(
  sql: Sql,
  user: User,
  spaceId: string,
  visibility: ThreadVisibility | undefined,
): Promise<Thread[]> {
  await requireMember(sql, spaceId, user.id)
  const visible = sql`(t.visibility = 'space' or t.owner_id = ${user.id})`
  const where = visibility
    ? sql`t.space_id = ${spaceId} and ${visible} and t.visibility = ${visibility}`
    : sql`t.space_id = ${spaceId} and ${visible}`
  return (await selectThreads(sql, where)).map(toThread)
}

export async function createThread(
  ctx: AppContext,
  user: User,
  spaceId: string,
  visibility: ThreadVisibility,
  title: string | undefined,
): Promise<Thread> {
  await requireMember(ctx.sql, spaceId, user.id)
  const id = newId()
  await ctx.sql`
    insert into threads (id, space_id, visibility, owner_id, title)
    values (${id}, ${spaceId}, ${visibility}, ${user.id}, ${title ?? ''})
  `
  const thread = await getThread(ctx.sql, id)
  ctx.hub.publishForThread(routing(thread), { type: 'thread.created', thread })
  return thread
}

export async function listMessages(
  ctx: AppContext,
  user: User,
  threadId: string,
  before: string | undefined,
  limit: number | undefined,
): Promise<Message[]> {
  const { sql } = ctx
  await requireThreadAccess(sql, threadId, user.id)
  const n = limit ?? DEFAULT_PAGE
  let where = sql`m.thread_id = ${threadId}`
  if (before !== undefined) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(before)) {
      throw new AppError(400, 'invalid_request', 'query.before: must be a message id')
    }
    where = sql`${where} and (m.created_at, m.id) < (
      select created_at, id from messages where id = ${before} and thread_id = ${threadId})`
  }
  const rows = await selectMessages(
    sql,
    where,
    sql`order by m.created_at desc, m.id desc limit ${n}`,
  )
  return withLiveText(ctx, await toMessages(sql, rows.reverse()))
}

/**
 * A streaming answer's text lives in memory until it settles (the database is written once, at the
 * end), so a streaming message is served with the text and sources forwarded so far. One that
 * settled between the read and now is read again, so it is never served empty.
 */
async function withLiveText(ctx: AppContext, messages: Message[]): Promise<Message[]> {
  const settled: string[] = []
  const out = messages.map((m) => {
    if (m.status !== 'streaming') return m
    const live = ctx.runningAnswers.get(m.id)
    if (!live) {
      settled.push(m.id)
      return m
    }
    // Read together, so the text covers exactly the deltas below streamSeq.
    return {
      ...m,
      content: live.text,
      citations: live.citations ?? m.citations,
      streamSeq: live.seq,
    }
  })
  if (settled.length === 0) return out
  const fresh = new Map(
    (
      await toMessages(
        ctx.sql,
        await selectMessages(ctx.sql, ctx.sql`m.id = any(${settled}::uuid[])`),
      )
    ).map((m) => [m.id, m]),
  )
  return out.map((m) => fresh.get(m.id) ?? m)
}

/** How long `abortMessage` waits for a stopped answer to record its final state. */
const ABORT_SETTLE_MS = 10_000

/**
 * Stop a streaming answer: the member who asked, or a Space owner. Anyone who cannot see the thread
 * gets the same 404 as for a message that does not exist. Stopping an answer that already settled is
 * a no-op, so a stop that races the last delta still succeeds.
 */
export async function abortMessage(ctx: AppContext, user: User, messageId: string): Promise<void> {
  const rows = await ctx.sql<
    {
      author_id: string
      role: string
      status: string
      thread_id: string
      space_id: string
      visibility: 'private' | 'space'
      owner_id: string
      member_role: SpaceRole
    }[]
  >`
    select m.author_id, m.role, m.status, m.thread_id, t.space_id, t.visibility, t.owner_id,
           sm.role as member_role
    from messages m
    join threads t on t.id = m.thread_id
    join space_members sm on sm.space_id = t.space_id and sm.user_id = ${user.id}
    where m.id = ${messageId} and (t.visibility = 'space' or t.owner_id = ${user.id})
  `
  const r = rows[0]
  if (!r) throw notFound('not_found', 'Message')
  if (r.author_id !== user.id && r.member_role !== 'owner') {
    throw new AppError(403, 'forbidden', 'Only the member who asked or a Space owner can stop it')
  }
  if (r.role !== 'assistant' || r.status !== 'streaming') return

  const live = ctx.runningAnswers.get(messageId)
  if (live) {
    live.controller.abort()
    let timer: NodeJS.Timeout | undefined
    await Promise.race([
      live.done,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ABORT_SETTLE_MS)
      }),
    ])
    clearTimeout(timer)
    return
  }
  // Streaming in storage but not running here: its answer was lost (a restart mid-answer) or has
  // not started yet. Settle it now; the answer, if it starts later, finds the row settled and stops.
  const updated = await ctx.sql`
    update messages set status = 'error', error_code = 'ai_aborted'
    where id = ${messageId} and status = 'streaming'
    returning id
  `
  if (updated.length === 0) return
  ctx.hub.publishForThread(
    { spaceId: r.space_id, visibility: r.visibility, ownerId: r.owner_id },
    {
      type: 'message.failed',
      spaceId: r.space_id,
      threadId: r.thread_id,
      messageId,
      code: 'ai_aborted',
      message: 'The answer was stopped',
    },
  )
}

/** A message just written whose thread may have been deleted since: the thread is gone, 404. */
async function messageOr404(sql: Sql, messageId: string): Promise<Message> {
  const [message] = await toMessages(sql, await selectMessages(sql, sql`m.id = ${messageId}`))
  if (!message) throw notFound('thread_not_found', 'Thread')
  return message
}

export async function postMessage(
  ctx: AppContext,
  user: User,
  threadId: string,
  body: PostMessageBody,
): Promise<{ message: Message; assistantMessage: Message | null }> {
  const { sql } = ctx
  const access = await requireThreadAccess(sql, threadId, user.id)
  const attachments = body.attachments ?? []
  if (attachments.length > 0 && access.visibility !== 'private') {
    throw new AppError(
      400,
      'attachments_not_allowed',
      'Pages can be attached only in a private thread; share the page to the Space instead',
    )
  }
  for (const a of attachments) assertCaptureAllowed(a.url)

  let model = body.model ?? null
  if (body.askAi) {
    const directory = await ctx.models.list()
    if (model) {
      const known = directory.models.find(
        (m) => m.provider === model?.provider && m.id === model?.id,
      )
      if (!known?.available) {
        throw new AppError(400, 'model_unavailable', 'That model is not available on this server')
      }
    } else {
      model = directory.defaultModel
    }
  }

  const messageId = newId()
  const assistantId = body.askAi ? newId() : null
  const titleFromContent = body.content.replace(/\s+/g, ' ').trim().slice(0, 80)
  const titled = await sql.begin(async (tx) => {
    // The access check ran outside this transaction; hold the thread so a concurrent delete either
    // finished first (404 here) or waits until these rows are in and then removes them with it.
    const [held] = await tx<{ visibility: ThreadVisibility }[]>`
      select visibility from threads where id = ${threadId} for share
    `
    if (!held) throw notFound('thread_not_found', 'Thread')
    // Shared since the access check: pages may not land in a Space thread.
    if (attachments.length > 0 && held.visibility !== 'private') {
      throw new AppError(
        400,
        'attachments_not_allowed',
        'Pages can be attached only in a private thread; share the page to the Space instead',
      )
    }
    await tx`
      insert into messages (id, thread_id, role, author_id, content, status)
      values (${messageId}, ${threadId}, 'user', ${user.id}, ${body.content}, 'complete')
    `
    for (const a of attachments) {
      await tx`
        insert into message_attachments (id, message_id, url, title, source_type, markdown, char_count)
        values (${newId()}, ${messageId}, ${a.url}, ${a.title}, ${a.sourceType}, ${a.markdown}, ${a.markdown.length})
      `
    }
    if (assistantId) {
      await tx`
        insert into messages (id, thread_id, role, author_id, model_provider, model_id, content, status)
        values (${assistantId}, ${threadId}, 'assistant', ${user.id}, ${model?.provider ?? null},
                ${model?.id ?? null}, '', 'streaming')
      `
    }
    // An untitled thread is named after its first message.
    const rows = await tx<{ id: string }[]>`
      update threads set title = ${titleFromContent}
      where id = ${threadId} and title = ''
      returning id
    `
    await tx`update threads set last_message_at = now() where id = ${threadId}`
    return rows.length > 0
  })

  const route = routing(access)
  const message = await messageOr404(sql, messageId)
  ctx.hub.publishForThread(route, { type: 'message.created', spaceId: access.spaceId, message })
  if (titled) {
    const thread = await getThread(sql, threadId)
    ctx.hub.publishForThread(route, { type: 'thread.updated', thread })
  }
  if (!assistantId) return { message, assistantMessage: null }

  let assistantMessage = await messageOr404(sql, assistantId)
  ctx.hub.publishForThread(route, {
    type: 'message.created',
    spaceId: access.spaceId,
    message: assistantMessage,
  })

  const fail = async (code: MessageErrorCode, text: string) => {
    const updated = await sql`
      update messages set status = 'error', error_code = ${code}
      where id = ${assistantId} and status = 'streaming'
      returning id
    `
    if (updated.length === 0) return getMessage(sql, assistantId)
    ctx.hub.publishForThread(route, {
      type: 'message.failed',
      spaceId: access.spaceId,
      threadId,
      messageId: assistantId,
      code,
      message: text,
    })
    return getMessage(sql, assistantId)
  }

  if (budgetExceeded(await getSpaceUsage(sql, access.spaceId))) {
    assistantMessage = await fail('budget_exceeded', "This Space has used this month's AI budget")
  } else if (!model) {
    assistantMessage = await fail('ai_unavailable', 'No AI model is configured on this server')
  } else {
    const history = await toMessages(
      sql,
      (
        await selectMessages(
          sql,
          sql`m.thread_id = ${threadId} and m.id not in (${messageId}, ${assistantId})`,
          sql`order by m.created_at desc, m.id desc limit ${HISTORY_LIMIT}`,
        )
      ).reverse(),
    )
    runAnswer(ctx, {
      thread: await getThread(sql, threadId),
      route,
      user,
      model,
      history,
      message,
      attachments: attachments.map((a) => ({
        url: a.url,
        title: a.title,
        sourceType: a.sourceType,
        markdown: a.markdown,
        charCount: a.markdown.length,
      })),
      assistantMessageId: assistantId,
    })
  }
  return { message, assistantMessage }
}

/** One message of a private thread as the share plan sees it, in thread order. */
export interface ShareCandidate {
  id: string
  role: 'user' | 'assistant'
  status: Message['status']
  attached: boolean
}

/**
 * Decide which messages of a private thread a share copies, or why it is refused. An attached question
 * (a user message with a page attached) must be listed in exactly one of the two lists; excluding a
 * user message also excludes its answers (the assistant messages after it, up to the next user
 * message). Throws an AppError and decides nothing when the request does not fit the thread.
 */
export function planThreadShare(
  messages: ShareCandidate[],
  includeAttached: string[],
  exclude: string[],
): ShareCandidate[] {
  const byId = new Map(messages.map((m) => [m.id, m]))
  const include = new Set(includeAttached)
  const excluded = new Set(exclude)
  if (include.size !== includeAttached.length || excluded.size !== exclude.length) {
    throw new AppError(400, 'invalid_request', 'A message is listed twice')
  }
  for (const id of [...include, ...excluded]) {
    if (!byId.has(id)) throw new AppError(400, 'invalid_request', 'A listed message is not in this thread')
    if (include.has(id) && excluded.has(id)) {
      throw new AppError(400, 'invalid_request', 'A message is both included and excluded')
    }
  }
  for (const id of include) {
    if (!byId.get(id)?.attached) {
      throw new AppError(
        400,
        'invalid_request',
        'includeAttachedMessageIds may list only questions that had a page attached',
      )
    }
  }
  if (messages.some((m) => m.attached && !include.has(m.id) && !excluded.has(m.id))) {
    throw new AppError(
      409,
      'thread_has_private_attachments',
      'Every question with an attached page must be included or excluded',
    )
  }
  const chosen: ShareCandidate[] = []
  let questionExcluded = false
  for (const m of messages) {
    if (m.role === 'user') questionExcluded = excluded.has(m.id)
    if (questionExcluded || excluded.has(m.id)) continue
    chosen.push(m)
  }
  if (chosen.length === 0) throw new AppError(400, 'invalid_request', 'Nothing is left to share')
  if (chosen.some((m) => m.status === 'streaming')) {
    throw new AppError(400, 'invalid_request', 'An answer is still being written; share it once it ends')
  }
  return chosen
}

/** How an untitled thread is named after a message (the same rule postMessage applies). */
const titleFrom = (content: string): string => content.replace(/\s+/g, ' ').trim().slice(0, 80)

/**
 * Share a private thread with the Space as a new Space thread holding copies of the chosen messages,
 * in their order and with their times, authors, models and citations. The private thread and its
 * attachments are left as they were; no attachment (content, title or URL) is copied. One
 * transaction; the Space hears one `thread.created` and one `audit.appended`.
 */
export async function shareThread(
  ctx: AppContext,
  user: User,
  threadId: string,
  includeAttached: string[],
  exclude: string[],
): Promise<Thread> {
  const access = await requireThreadAccess(ctx.sql, threadId, user.id)
  if (access.ownerId !== user.id) {
    throw new AppError(403, 'forbidden', 'Only the member who owns a thread can share it')
  }
  if (access.visibility !== 'private') {
    throw new AppError(409, 'already_shared', 'This thread is already in the Space')
  }
  const newThreadId = newId()
  const event = await ctx.sql.begin(async (tx) => {
    // Posts hold the thread FOR SHARE until their rows are in, so this waits for them, and no
    // message or attachment lands in the thread while it is read.
    const [held] = await tx<{ title: string }[]>`
      select title from threads where id = ${threadId} for update
    `
    if (!held) throw notFound('thread_not_found', 'Thread')
    const rows = await tx<
      {
        id: string
        role: 'user' | 'assistant'
        author_id: string
        model_provider: string | null
        model_id: string | null
        content: string
        citations: StoredCitation[]
        status: Message['status']
        error_code: string | null
        usage: TokenUsage | null
        created_at: Date
        attached: boolean
      }[]
    >`
      select m.id, m.role, m.author_id, m.model_provider, m.model_id, m.content, m.citations,
             m.status, m.error_code, m.usage, m.created_at,
             exists (select 1 from message_attachments a where a.message_id = m.id) as attached
      from messages m
      where m.thread_id = ${threadId}
      order by m.created_at, m.id
      for share of m
    `
    const chosen = new Set(planThreadShare(rows, includeAttached, exclude).map((m) => m.id))
    const copies = rows.filter((r) => chosen.has(r.id))

    // The private title was taken from the first question (or given before it). If that question had
    // a page attached, the title may come from it, so the copy is named after what it shares instead.
    const firstQuestion = rows.find((r) => r.role === 'user')
    const firstIncluded = copies.find((r) => r.role === 'user')
    const title =
      firstQuestion && !firstQuestion.attached
        ? held.title
        : firstIncluded
          ? titleFrom(firstIncluded.content)
          : ''
    const last = copies[copies.length - 1]
    await tx`
      insert into threads (id, space_id, visibility, owner_id, title, last_message_at)
      values (${newThreadId}, ${access.spaceId}, 'space', ${user.id}, ${title},
              ${last ? last.created_at : null})
    `
    for (const r of copies) {
      // Cited items are held until commit, as when an answer settles: an unshare either committed
      // first (the quote is emptied here) or waits and then scrubs this copy too.
      const { stored } = await settleCitations(tx, access.spaceId, r.citations, true)
      await tx`
        insert into messages (id, thread_id, role, author_id, model_provider, model_id, content,
                              citations, status, error_code, usage, created_at)
        values (${newId()}, ${newThreadId}, ${r.role}, ${r.author_id}, ${r.model_provider},
                ${r.model_id}, ${r.content}, ${tx.json(stored)}, ${r.status}, ${r.error_code},
                ${r.usage === null ? null : tx.json(r.usage)}, ${r.created_at})
      `
    }
    return appendAudit(tx, {
      spaceId: access.spaceId,
      actor: userRef(user.id, user.name, user.avatarUrl),
      action: 'thread.shared',
      target: { type: 'thread', id: newThreadId, title: title || null, url: null },
    })
  })
  const thread = await getThread(ctx.sql, newThreadId)
  ctx.hub.publishToSpace(access.spaceId, { type: 'thread.created', thread })
  ctx.hub.publishToSpace(access.spaceId, { type: 'audit.appended', event })
  return thread
}

/** The thread's owner may delete it; a Space owner may also delete Space threads. */
export async function deleteThread(ctx: AppContext, user: User, threadId: string): Promise<void> {
  const access = await requireThreadAccess(ctx.sql, threadId, user.id)
  if (access.ownerId !== user.id && access.role !== 'owner') {
    throw new AppError(403, 'forbidden', 'Only the thread owner or a Space owner can delete it')
  }
  for (const a of ctx.runningAnswers.values()) if (a.threadId === threadId) a.controller.abort()
  await ctx.sql`delete from threads where id = ${threadId}`
  ctx.hub.publishForThread(routing(access), {
    type: 'thread.deleted',
    spaceId: access.spaceId,
    threadId,
  })
}
