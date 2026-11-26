import {
  canonicalUrl,
  captureEligibility,
  type ExtractedPage,
  type Item,
  type ItemDetail,
  type ItemIndexEntry,
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
import {
  iso,
  selectItems,
  toItem,
  toItemDetail,
  toVersionRef,
  userRef,
  type VersionRow,
} from './rows'

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
  if (!ctx.shareLimiter.take(user.id)) {
    throw new AppError(429, 'rate_limited', 'Too many shares in a short time; try again in a minute')
  }

  const urlKey = canonicalUrl(page.url)
  const hash = sha256Hex(page.markdown)
  const actor = userRef(user.id, user.name, user.avatarUrl)

  const result = await sql.begin(async (tx) => {
    let outcome: ShareItemResult['outcome'] | null = null
    let id = ''
    let number = 0
    // Two attempts: if an unshare deletes the row between the conflicting insert and the lock, the
    // second insert takes the new-item path.
    for (let attempt = 0; attempt < 2 && outcome === null; attempt++) {
      const itemId = newId()
      const inserted = await tx<{ id: string }[]>`
        insert into items (id, space_id, url, url_key, title, source_type, shared_by, status)
        values (${itemId}, ${spaceId}, ${page.url}, ${urlKey}, ${page.title}, ${page.sourceType}, ${user.id}, 'indexing')
        on conflict (space_id, url_key) do nothing
        returning id
      `
      if (inserted[0]) {
        outcome = 'new'
        id = itemId
        number = 1
        break
      }
      // Lock the item row on its own: with a join, a waiter re-checks the join against the old
      // version after the holder commits and gets no row at all. The lock serialises concurrent
      // shares of the same page so version numbers cannot collide.
      const [locked] = await tx<{ id: string; status: string; current_version_id: string | null }[]>`
        select id, status, current_version_id from items
        where space_id = ${spaceId} and url_key = ${urlKey}
        for update
      `
      if (!locked) continue
      const [current] = await tx<{ content_hash: string; number: number }[]>`
        select content_hash, number from item_versions where id = ${locked.current_version_id}
      `
      const [top] = await tx<{ max: number | null }[]>`
        select max(number)::int as max from item_versions where item_id = ${locked.id}
      `
      if (current && current.content_hash === hash) {
        return {
          outcome: 'unchanged' as const,
          id: locked.id,
          versionId: null,
          event: null,
          reindex: locked.status !== 'ready' ? (locked.current_version_id ?? null) : null,
        }
      }
      outcome = 'version'
      id = locked.id
      number = (top?.max ?? 0) + 1
    }
    if (outcome === null) throw new Error('item row kept disappearing during share')
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
    return { outcome, id, versionId, event, reindex: null as string | null }
  })

  const item = await getItemRow(sql, result.id)
  if (result.versionId && result.event) {
    ctx.hub.publishToSpace(spaceId, { type: 'item.upserted', item })
    ctx.hub.publishToSpace(spaceId, { type: 'audit.appended', event: result.event })
    startIndexing(ctx, item, result.versionId, page)
  } else if (result.reindex) {
    // Same content, but its index was lost (a failure or an interrupted run): build it again.
    startIndexing(ctx, item, result.reindex, page)
  }
  return { item, outcome: result.outcome }
}

/**
 * Re-run the Indexer for the current version of an item, from the stored Markdown. Used on startup
 * for items whose indexing was interrupted or failed.
 */
export async function reindexItem(ctx: AppContext, itemId: string): Promise<boolean> {
  const [row] = await ctx.sql<
    { version_id: string; url: string; title: string; markdown: string; lang: string | null }[]
  >`
    select v.id as version_id, i.url, i.title, v.markdown, v.lang
    from items i join item_versions v on v.id = i.current_version_id
    where i.id = ${itemId}
  `
  if (!row) return false
  const item = await getItemRow(ctx.sql, itemId)
  startIndexing(ctx, item, row.version_id, {
    url: row.url,
    title: row.title,
    sourceType: item.sourceType,
    markdown: row.markdown,
    lang: row.lang,
  })
  return true
}

/**
 * Run the Indexer for one version in the background, then settle the item's status. A result for a
 * version that is no longer current is discarded: a newer share is already being indexed.
 */
function startIndexing(
  ctx: AppContext,
  item: Item,
  versionId: string,
  page: Pick<ExtractedPage, 'url' | 'title' | 'sourceType' | 'markdown' | 'lang'>,
): void {
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
      // Stopped by shutdown: the item stays 'indexing' and the next start re-runs it.
      if (ctx.shutdown.signal.aborted) return
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
  // Answers still streaming serve their sources from memory; drop the quote there too.
  for (const live of ctx.runningAnswers.values()) {
    if (live.spaceId !== access.spaceId || !live.citations) continue
    live.citations = live.citations.map((c) =>
      c.itemId === itemId ? { ...c, quote: '', available: false } : c,
    )
  }
  ctx.hub.publishToSpace(access.spaceId, {
    type: 'item.deleted',
    spaceId: access.spaceId,
    itemId,
    url: result.url,
  })
  ctx.hub.publishToSpace(access.spaceId, { type: 'audit.appended', event: result.event })
}

/**
 * The caller's item index: one row per item in every Space they belong to, in one query. The client
 * matches its open tabs against it locally, so the URLs of pages a member merely has open never
 * reach the server. Membership is the join condition, so another Space's items cannot appear.
 */
export async function listItemIndex(sql: Sql, userId: string): Promise<ItemIndexEntry[]> {
  const rows = await sql<
    {
      id: string
      space_id: string
      url_key: string
      title: string
      sb_id: string
      sb_name: string
      sb_avatar: string | null
      v_number: number
      v_hash: string
      updated_at: Date
    }[]
  >`
    select i.id, i.space_id, i.url_key, i.title,
           su.id as sb_id, su.name as sb_name, su.avatar_url as sb_avatar,
           v.number as v_number, v.content_hash as v_hash, i.updated_at
    from items i
    join space_members m on m.space_id = i.space_id and m.user_id = ${userId}
    join users su on su.id = i.shared_by
    join item_versions v on v.id = i.current_version_id
    order by i.updated_at desc, i.id desc
  `
  return rows.map((r) => ({
    itemId: r.id,
    spaceId: r.space_id,
    urlKey: r.url_key,
    title: r.title,
    sharedBy: userRef(r.sb_id, r.sb_name, r.sb_avatar),
    versionNumber: r.v_number,
    contentHash: r.v_hash,
    updatedAt: iso(r.updated_at),
  }))
}
