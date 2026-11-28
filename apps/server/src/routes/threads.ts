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
  registerRoute(app, api.shareThread, async ({ params, body }, { user }) =>
    shareThread(ctx, user, params.threadId, body.includeAttachedMessageIds, body.excludeMessageIds),
  )
  registerRoute(app, api.deleteThread, async ({ params }, { user }) => {
    await deleteThread(ctx, user, params.threadId)
    return ok
  })
  registerRoute(app, api.recordExport, async ({ params, body }, { user }) => {
    await requireMember(ctx.sql, params.spaceId, user.id)
    // Google Docs is the only exit; anything else would plant an arbitrary link in the audit feed.
    if (!isGoogleDocUrl(body.url)) {
      throw new AppError(400, 'invalid_request', 'url: must be a https://docs.google.com/ document')
    }
    let fromPrivateThread = false
    if (body.messageId) {
      // The exported message must be one this member can read in this Space.
      const rows = await ctx.sql<{ visibility: string }[]>`
        select t.visibility from messages m join threads t on t.id = m.thread_id
        where m.id = ${body.messageId} and t.space_id = ${params.spaceId}
          and (t.visibility = 'space' or t.owner_id = ${user.id})
      `
      if (!rows[0]) throw new AppError(404, 'not_found', 'Message not found')
      fromPrivateThread = rows[0].visibility === 'private'
    }
    // Every member reads the audit log: an export of a private answer is recorded without its title
    // or Doc URL, which would reveal what the private thread was about.
    const event = await appendAudit(ctx.sql, {
      spaceId: params.spaceId,
      actor: userRef(user.id, user.name, user.avatarUrl),
      action: 'export.google_doc',
      target: fromPrivateThread
        ? { type: 'export', id: body.messageId ?? '', title: null, url: null }
        : { type: 'export', id: body.messageId ?? body.url, title: body.title, url: body.url },
    })
    ctx.hub.publishToSpace(params.spaceId, { type: 'audit.appended', event })
    return ok
  })
}

/** https://docs.google.com/... and nothing that merely starts with that text. */
export function isGoogleDocUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && u.hostname === 'docs.google.com' && u.username === ''
  } catch {
    return false
  }
}
