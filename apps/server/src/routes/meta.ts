import { api } from '@tiger/shared'
import type { FastifyInstance } from 'fastify'
import { AppError } from '../errors'
import { registerRoute } from '../http/registry'

export const SERVER_VERSION = '0.0.0'

export function metaRoutes(app: FastifyInstance): void {
  const ctx = app.tiger
  registerRoute(app, api.health, async () => ({ ok: true as const, version: SERVER_VERSION }))
  registerRoute(app, api.listModels, async () => {
    const { models, defaultModel } = await ctx.models.list()
    // The contract requires a default; without one there is nothing the client could pick.
    if (!defaultModel) {
      throw new AppError(503, 'ai_unavailable', 'No AI model is configured on this server')
    }
    return { models, defaultModel }
  })
}
