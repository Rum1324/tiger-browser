import type {
  Message,
  PostMessageBody,
  SpaceRole,
  Thread,
  ThreadVisibility,
  User,
} from '@tiger/shared'
import type { AppContext } from '../context'
import type { Sql } from '../db/sql'
import { AppError, notFound } from '../errors'
import { newId } from '../ids'
import { requireMember, requireThreadAccess, type ThreadAccess } from './access'
import { runAnswer } from './answers'
import { appendAudit } from './audit'
import { assertCaptureAllowed } from './items'
import { getMessage, selectMessages, selectThreads, toMessages, toThread, userRef } from './rows'
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
    return { ...m, content: live.text, citations: live.citations ?? m.citations }
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
  const message = await getMessage(sql, messageId)
  ctx.hub.publishForThread(route, { type: 'message.created', spaceId: access.spaceId, message })
  if (titled) {
    const thread = await getThread(sql, threadId)
    ctx.hub.publishForThread(route, { type: 'thread.updated', thread })
  }
  if (!assistantId) return { message, assistantMessage: null }

  let assistantMessage = await getMessage(sql, assistantId)
  ctx.hub.publishForThread(route, {
    type: 'message.created',
    spaceId: access.spaceId,
    message: assistantMessage,
  })

  const fail = async (code: string, text: string) => {
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

/** Promote a private thread to the Space. Attachment contents are deleted, never carried over. */
export async function shareThread(ctx: AppContext, user: User, threadId: string): Promise<Thread> {
  const access = await requireThreadAccess(ctx.sql, threadId, user.id)
  if (access.visibility === 'space') return getThread(ctx.sql, threadId)
  const event = await ctx.sql.begin(async (tx) => {
    await tx`
      delete from message_attachments
      where message_id in (select id from messages where thread_id = ${threadId})
    `
    await tx`update threads set visibility = 'space' where id = ${threadId}`
    return appendAudit(tx, {
      spaceId: access.spaceId,
      actor: userRef(user.id, user.name, user.avatarUrl),
      action: 'thread.shared',
      target: { type: 'thread', id: threadId, title: access.title || null, url: null },
    })
  })
  const thread = await getThread(ctx.sql, threadId)
  ctx.hub.publishToSpace(access.spaceId, { type: 'thread.updated', thread })
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
