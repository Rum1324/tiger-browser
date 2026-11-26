import { api } from '@tiger/shared'
import type { FastifyInstance } from 'fastify'
import { registerRoute } from '../http/registry'
import { requireMember } from '../services/access'
import { listAudit } from '../services/audit'
import {
  acceptInvite,
  createInvite,
  createSpace,
  getSpaceDetail,
  listSpaces,
  removeMember,
  revokeInvite,
  updateSpace,
} from '../services/spaces'
import { getSpaceUsage } from '../services/usage'

export function spaceRoutes(app: FastifyInstance): void {
  const ctx = app.tiger
  const ok = { ok: true as const }

  registerRoute(app, api.listSpaces, async (_i, { user }) => listSpaces(ctx.sql, user.id))
  registerRoute(app, api.createSpace, async ({ body }, { user }) => createSpace(ctx, user, body))
  registerRoute(app, api.getSpace, async ({ params }, { user }) =>
    getSpaceDetail(ctx.sql, params.spaceId, user.id),
  )
  registerRoute(app, api.updateSpace, async ({ params, body }, { user }) =>
    updateSpace(ctx, user, params.spaceId, body),
  )
  registerRoute(app, api.createInvite, async ({ params, body }, { user }) =>
    createInvite(ctx, user, params.spaceId, body.email ?? null),
  )
  registerRoute(app, api.revokeInvite, async ({ params }, { user }) => {
    await revokeInvite(ctx, user, params.spaceId, params.inviteId)
    return ok
  })
  registerRoute(
    app,
    api.acceptInvite,
    async ({ body }, { user }) => acceptInvite(ctx, user, body.token),
    // Invite tokens are bearer secrets: slow down guessing even for signed-in callers.
    { rateLimitPerMinute: ctx.config.authRateLimitPerMinute },
  )
  registerRoute(app, api.removeMember, async ({ params }, { user }) => {
    await removeMember(ctx, user, params.spaceId, params.userId)
    return ok
  })
  registerRoute(app, api.listAudit, async ({ params, query }, { user }) => {
    await requireMember(ctx.sql, params.spaceId, user.id)
    return listAudit(ctx.sql, params.spaceId, query.limit ?? 50)
  })
  registerRoute(app, api.getUsage, async ({ params }, { user }) => {
    await requireMember(ctx.sql, params.spaceId, user.id)
    return getSpaceUsage(ctx.sql, params.spaceId)
  })
}
