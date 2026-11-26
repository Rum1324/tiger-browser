import { api } from '@tiger/shared'
import type { FastifyInstance } from 'fastify'
import { createSession, deleteSession } from '../auth/sessions'
import { AppError } from '../errors'
import { registerRoute } from '../http/registry'
import type { GoogleIdentity } from '../seams'
import { listSpaces } from '../services/spaces'
import { updateUser, upsertGoogleUser, upsertUserByEmail } from '../services/users'

export function authRoutes(app: FastifyInstance): void {
  const ctx = app.tiger
  const limit = { rateLimitPerMinute: ctx.config.authRateLimitPerMinute }

  registerRoute(
    app,
    api.authDev,
    async ({ body }) => {
      if (!ctx.config.devLogin)
        throw new AppError(404, 'dev_login_disabled', 'Dev login is disabled')
      const user = await upsertUserByEmail(ctx.sql, body.email, body.name)
      const token = await createSession(ctx.sql, user.id, ctx.config.sessionTtlDays)
      return { token, user }
    },
    limit,
  )

  registerRoute(
    app,
    api.authGoogle,
    async ({ body }) => {
      const verify = ctx.verifyGoogleIdToken
      if (!verify) {
        throw new AppError(503, 'google_auth_unavailable', 'Google sign-in is not configured')
      }
      let identity: GoogleIdentity
      try {
        identity = await verify(body.idToken)
      } catch {
        throw new AppError(401, 'google_token_invalid', 'The Google ID token is not valid')
      }
      if (!identity.emailVerified) {
        throw new AppError(401, 'google_token_invalid', 'The Google account email is not verified')
      }
      const user = await upsertGoogleUser(ctx.sql, identity)
      const token = await createSession(ctx.sql, user.id, ctx.config.sessionTtlDays)
      return { token, user }
    },
    limit,
  )

  registerRoute(app, api.authLogout, async (_input, { sessionHash }) => {
    await deleteSession(ctx.sql, sessionHash)
    ctx.hub.closeSession(sessionHash.toString('hex'))
    return { ok: true as const }
  })

  registerRoute(app, api.me, async (_input, { user }) => ({
    user,
    spaces: await listSpaces(ctx.sql, user.id),
  }))

  registerRoute(app, api.updateMe, async ({ body }, { user }) => updateUser(ctx.sql, user.id, body))
}
