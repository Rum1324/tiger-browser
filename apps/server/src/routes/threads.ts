import { api } from '@tiger/shared'
import type { FastifyInstance } from 'fastify'
import { AppError } from '../errors'
import { registerRoute } from '../http/registry'
import { requireMember } from '../services/access'
import { appendAudit } from '../services/audit'
import { userRef } from '../services/rows'
import {
  abortMessage,
  createThread,
  deleteThread,
  listMessages,
  listThreads,
  postMessage,
  shareThread,
} from '../services/threads'

export function threadRoutes(app: FastifyInstance): void {
  const ctx = app.tiger
  const ok = { ok: true as const }

  registerRoute(app, api.listThreads, async ({ params, query }, { user }) =>
    listThreads(ctx.sql, user, params.spaceId, query.visibility),
  )
  registerRoute(app, api.createThread, async ({ params, body }, { user }) =>
    createThread(ctx, user, params.spaceId, body.visibility, body.title),
  )
  registerRoute(app, api.listMessages, async ({ params, query }, { user }) =>
    listMessages(ctx, user, params.threadId, query.before, query.limit),
  )
  registerRoute(app, api.abortMessage, async ({ params }, { user }) => {
    await abortMessage(ctx, user, params.messageId)
    return ok
  })
  registerRoute(app, api.postMessage, async ({ params, body }, { user }) =>
    postMessage(ctx, user, params.threadId, body),
  )
  registerRoute(app, api.shareThread, async ({ params }, { user }) =>
    shareThread(ctx, user, params.threadId),
  )
  registerRoute(app, api.deleteThread, async ({ params }, { user }) => {
    await deleteThread(ctx, user, params.threadId)
    return ok
  })
  registerRoute(app, api.recordExport, async ({ params, body }, { user }) => {
    await requireMember(ctx.sql, params.spaceId, user.id)
    if (body.messageId) {
      // The exported message must be one this member can read in this Space.
      const rows = await ctx.sql`
        select 1 from messages m join threads t on t.id = m.thread_id
        where m.id = ${body.messageId} and t.space_id = ${params.spaceId}
          and (t.visibility = 'space' or t.owner_id = ${user.id})
      `
      if (rows.length === 0) throw new AppError(404, 'not_found', 'Message not found')
    }
    const event = await appendAudit(ctx.sql, {
      spaceId: params.spaceId,
      actor: userRef(user.id, user.name, user.avatarUrl),
      action: 'export.google_doc',
      target: { type: 'export', id: body.messageId ?? body.url, title: body.title, url: body.url },
    })
    ctx.hub.publishToSpace(params.spaceId, { type: 'audit.appended', event })
    return ok
  })
}
