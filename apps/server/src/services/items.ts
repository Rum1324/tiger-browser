import {
  canonicalUrl,
  captureEligibility,
  type ExtractedPage,
  type Item,
  type ItemDetail,
  type ItemVersionRef,
  type ShareItemResult,
  type User,
} from '@tiger/shared'
import { sha256Hex } from '../auth/tokens'
import type { AppContext } from '../context'
import type { Sql } from '../db/sql'
import { AppError, notFound } from '../errors'
import { newId } from '../ids'
import { requireItemAccess, requireMember } from './access'
import { appendAudit } from './audit'
import { selectItems, toItem, toItemDetail, toVersionRef, userRef, type VersionRow } from './rows'

/**
 * Defence in depth: the browser's main process already refuses to capture these pages, but a
 * modified or buggy client must not be able to store them either.
 */
export function assertCaptureAllowed(url: string): void {
  const verdict = captureEligibility(url, { incognito: false })
  if (!verdict.allowed) {
    throw new AppError(
      422,
      'capture_blocked',
      `Pages of this kind cannot be shared (${verdict.reason ?? 'blocked'})`,
    )
  }
}

export async function getItemRow(sql: Sql, itemId: string): Promise<Item> {
  const row = (await selectItems(sql, sql`i.id = ${itemId}`))[0]
  if (!row) throw notFound('item_not_found', 'Item')
  return toItem(row)
}

export async function listItems(sql: Sql, spaceId: string, userId: string): Promise<Item[]> {
  await requireMember(sql, spaceId, userId)
  return (await selectItems(sql, sql`i.space_id = ${spaceId}`)).map(toItem)
}

export async function getItemDetail(sql: Sql, itemId: string, userId: string): Promise<ItemDetail> {
  await requireItemAccess(sql, itemId, userId)
  const row = (await selectItems(sql, sql`i.id = ${itemId}`, true))[0]
  if (!row) throw notFound('item_not_found', 'Item')
  return toItemDetail(row)
}

export async function listVersions(
  sql: Sql,
  itemId: string,
  userId: string,
): Promise<ItemVersionRef[]> {
  await requireItemAccess(sql, itemId, userId)
  const rows = await sql<VersionRow[]>`
    select v.id, v.number, v.char_count, v.content_hash, v.captured_at,
           u.id as cb_id, u.name as cb_name, u.avatar_url as cb_avatar
    from item_versions v join users u on u.id = v.captured_by
    where v.item_id = ${itemId}
    order by v.number desc
  `
  return rows.map(toVersionRef)
}

export async function shareItem(
  ctx: AppContext,
  user: User,
  spaceId: string,
  page: ExtractedPage,
): Promise<ShareItemResult> {
  const { sql } = ctx
  await requireMember(sql, spaceId, user.id)
  assertCaptureAllowed(page.url)

  const urlKey = canonicalUrl(page.url)
  const hash = sha256Hex(page.markdown)
  const actor = userRef(user.id, user.name, user.avatarUrl)

  const result = await sql.begin(async (tx) => {
    const itemId = newId()
    const inserted = await tx<{ id: string }[]>`
      insert into items (id, space_id, url, url_key, title, source_type, shared_by, status)
      values (${itemId}, ${spaceId}, ${page.url}, ${urlKey}, ${page.title}, ${page.sourceType}, ${user.id}, 'indexing')
      on conflict (space_id, url_key) do nothing
      returning id
    `
    let outcome: ShareItemResult['outcome']
    let id: string
    let number: number
    if (inserted[0]) {
      outcome = 'new'
      id = itemId
      number = 1
    } else {
      // Row lock serialises concurrent shares of the same page so version numbers cannot collide.
      const existing = await tx<{ id: string; content_hash: string; number: number }[]>`
        select i.id, v.content_hash, v.number
        from items i join item_versions v on v.id = i.current_version_id
        where i.space_id = ${spaceId} and i.url_key = ${urlKey}
        for update of i
      `
      const ex = existing[0]
      if (!ex) throw new Error('item row disappeared during share')
      if (ex.content_hash === hash)
        return { outcome: 'unchanged' as const, id: ex.id, versionId: null, event: null }
      outcome = 'version'
      id = ex.id
      number = ex.number + 1
    }
    const versionId = newId()
    await tx`
      insert into item_versions (id, item_id, number, markdown, content_hash, char_count, extractor, lang,
                                 byline, site_name, captured_at, captured_by)
      values (${versionId}, ${id}, ${number}, ${page.markdown}, ${hash}, ${page.markdown.length},
              ${page.extractor}, ${page.lang}, ${page.byline}, ${page.siteName},
              ${page.capturedAt}::timestamptz, ${user.id})
    `
    await tx`
      update items set current_version_id = ${versionId}, title = ${page.title}, url = ${page.url},
                       source_type = ${page.sourceType}, status = 'indexing', updated_at = now()
      where id = ${id}
    `
    const event = await appendAudit(tx, {
      spaceId,
      actor,
      action: outcome === 'new' ? 'item.shared' : 'item.reshared',
      target: { type: 'item', id, title: page.title, url: page.url },
    })
    return { outcome, id, versionId, event }
  })

  const item = await getItemRow(sql, result.id)
  if (result.versionId && result.event) {
    ctx.hub.publishToSpace(spaceId, { type: 'item.upserted', item })
    ctx.hub.publishToSpace(spaceId, { type: 'audit.appended', event: result.event })
    startIndexing(ctx, item, result.versionId, page)
  }
  return { item, outcome: result.outcome }
}

/**
 * Run the Indexer for one version in the background, then settle the item's status. A result for a
 * version that is no longer current is discarded: a newer share is already being indexed.
 */
function startIndexing(ctx: AppContext, item: Item, versionId: string, page: ExtractedPage): void {
  ctx.background.run(`index ${item.id}`, async () => {
    let ok = true
    try {
      await ctx.indexer.index({
        spaceId: item.spaceId,
        itemId: item.id,
        itemVersionId: versionId,
        url: page.url,
        title: page.title,
        sourceType: page.sourceType,
        markdown: page.markdown,
        lang: page.lang,
        signal: ctx.shutdown.signal,
      })
    } catch (err) {
      ok = false
      ctx.log.warn({ err, itemId: item.id }, 'indexing failed')
    }
    const updated = await ctx.sql.begin(async (tx) => {
      const rows = await tx`
        update items set status = ${ok ? 'ready' : 'failed'}
        where id = ${item.id} and current_version_id = ${versionId}
        returning id
      `
      if (rows.length === 0) return false
      // Only the current version is chunked (see the schema); drop anything left from older ones.
      await tx`delete from chunks where item_id = ${item.id} and item_version_id <> ${versionId}`
      return true
    })
    if (!updated) return
    const fresh = (await selectItems(ctx.sql, ctx.sql`i.id = ${item.id}`))[0]
    if (fresh) ctx.hub.publishToSpace(item.spaceId, { type: 'item.upserted', item: toItem(fresh) })
  })
}

/**
 * Unshare: the sharer or a Space owner. Deletes the item (versions and chunks cascade), empties the
 * quote of every stored citation of it, and leaves an audit tombstone with the title and URL.
 */
export async function unshareItem(ctx: AppContext, user: User, itemId: string): Promise<void> {
  const access = await requireItemAccess(ctx.sql, itemId, user.id)
  if (access.sharedBy !== user.id && access.role !== 'owner') {
    throw new AppError(
      403,
      'forbidden',
      'Only the member who shared this or a Space owner can unshare it',
    )
  }
  const result = await ctx.sql.begin(async (tx) => {
    const rows = await tx<{ title: string; url: string }[]>`
      delete from items where id = ${itemId} returning title, url
    `
    const gone = rows[0]
    if (!gone) throw notFound('item_not_found', 'Item')
    await tx`
      update messages m set citations = (
        select coalesce(jsonb_agg(
                 case when c->>'itemId' = ${itemId} then jsonb_set(c, '{quote}', '""'::jsonb) else c end
                 order by ord), '[]'::jsonb)
        from jsonb_array_elements(m.citations) with ordinality as e(c, ord)
      )
      where m.thread_id in (select id from threads where space_id = ${access.spaceId})
        and m.citations @> ${tx.json([{ itemId }])}
    `
    const event = await appendAudit(tx, {
      spaceId: access.spaceId,
      actor: userRef(user.id, user.name, user.avatarUrl),
      action: 'item.unshared',
      target: { type: 'item', id: itemId, title: gone.title, url: gone.url },
    })
    return { url: gone.url, event }
  })
  ctx.hub.publishToSpace(access.spaceId, {
    type: 'item.deleted',
    spaceId: access.spaceId,
    itemId,
    url: result.url,
  })
  ctx.hub.publishToSpace(access.spaceId, { type: 'audit.appended', event: result.event })
}

/** Which of the caller's Spaces already hold each URL, matched by canonical form. */
export async function lookupByUrl(sql: Sql, userId: string, urls: string[]) {
  const byKey = new Map<string, string[]>()
  for (const url of urls) {
    const key = canonicalUrl(url)
    const list = byKey.get(key)
    if (list) list.push(url)
    else byKey.set(key, [url])
  }
  const rows = await sql<
    { id: string; space_id: string; url_key: string; shared_by: string; updated_at: Date }[]
  >`
    select i.id, i.space_id, i.url_key, i.shared_by, i.updated_at
    from items i join space_members m on m.space_id = i.space_id and m.user_id = ${userId}
    where i.url_key = any(${[...byKey.keys()]}::text[])
    order by i.updated_at desc
  `
  return rows.flatMap((r) =>
    (byKey.get(r.url_key) ?? []).map((url) => ({
      url,
      itemId: r.id,
      spaceId: r.space_id,
      sharedBy: r.shared_by,
      updatedAt: r.updated_at.toISOString(),
    })),
  )
}
