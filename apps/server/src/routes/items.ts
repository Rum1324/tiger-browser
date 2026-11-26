import { api } from '@tiger/shared'
import type { FastifyInstance } from 'fastify'
import { registerRoute } from '../http/registry'
import { requireMember } from '../services/access'
import {
  getItemDetail,
  listItems,
  listVersions,
  lookupByUrl,
  shareItem,
  unshareItem,
} from '../services/items'

const DEFAULT_K = 8

export function itemRoutes(app: FastifyInstance): void {
  const ctx = app.tiger

  registerRoute(app, api.shareItem, async ({ params, body }, { user }) =>
    shareItem(ctx, user, params.spaceId, body.page),
  )
  registerRoute(app, api.listItems, async ({ params }, { user }) =>
    listItems(ctx.sql, params.spaceId, user.id),
  )
  registerRoute(app, api.lookupItemsByUrl, async ({ body }, { user }) =>
    lookupByUrl(ctx.sql, user.id, body.urls),
  )
  registerRoute(app, api.getItem, async ({ params }, { user }) =>
    getItemDetail(ctx.sql, params.itemId, user.id),
  )
  registerRoute(app, api.listItemVersions, async ({ params }, { user }) =>
    listVersions(ctx.sql, params.itemId, user.id),
  )
  registerRoute(app, api.unshareItem, async ({ params }, { user }) => {
    await unshareItem(ctx, user, params.itemId)
    return { ok: true as const }
  })
  registerRoute(app, api.search, async ({ params, body }, { user }) => {
    await requireMember(ctx.sql, params.spaceId, user.id)
    return ctx.retriever.search({
      spaceId: params.spaceId,
      query: body.query,
      k: body.k ?? DEFAULT_K,
      signal: ctx.shutdown.signal,
    })
  })
}
