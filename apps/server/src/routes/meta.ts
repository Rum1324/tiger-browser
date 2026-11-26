import { api } from '@tiger/shared'
import type { FastifyInstance } from 'fastify'
import { registerRoute } from '../http/registry'

export const SERVER_VERSION = '0.0.0'

export function metaRoutes(app: FastifyInstance): void {
  const ctx = app.tiger
  registerRoute(app, api.health, async () => ({ ok: true as const, version: SERVER_VERSION }))
  // defaultModel is null when no provider is configured; the client then shows the picker disabled.
  registerRoute(app, api.listModels, async () => ctx.models.list())
}
