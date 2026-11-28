import type {
  AuditEvent,
  Citation,
  Item,
  ItemDetail,
  ItemVersionRef,
  Locale,
  Message,
  MessageErrorCode,
  PageAttachment,
  Provider,
  SourceType,
  Space,
  SpaceHue,
  SpaceRole,
  Thread,
  ThreadVisibility,
  TokenUsage,
  User,
  UserRef,
} from '@tiger/shared'
import type { Fragment, Sql, TxSql } from '../db/sql'

/**
 * Row types and row → contract mappers. Timestamps come back from postgres.js as Date and leave as
 * ISO strings with `Z`, which is what the contract's IsoDate accepts.
 */

export const iso = (d: Date): string => d.toISOString()

export interface UserRow {
  id: string
  email: string
  name: string
  avatar_url: string | null
  locale: string
}

export function toUser(r: UserRow): User {
  return {
    id: r.id,
    name: r.name,
    avatarUrl: r.avatar_url,
    email: r.email,
    locale: r.locale as Locale,
  }
}

export const userRef = (id: string, name: string, avatarUrl: string | null): UserRef => ({
  id,
  name,
  avatarUrl,
})

// ── Spaces ──────────────────────────────────────────────────────────────────

export interface SpaceRow {
  id: string
  name: string
  hue: string
  created_by: string
  created_at: Date
  member_count: number
  item_count: number
  my_role: string
}

export function toSpace(r: SpaceRow): Space {
  return {
    id: r.id,
    name: r.name,
    hue: r.hue as SpaceHue,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    memberCount: r.member_count,
    itemCount: r.item_count,
    myRole: r.my_role as SpaceRole,
  }
}

/** Spaces the user belongs to, optionally narrowed to one id. */
export function selectSpaces(sql: Sql, userId: string, spaceId?: string) {
  return sql<SpaceRow[]>`
    select s.id, s.name, s.hue, s.created_by, s.created_at, m.role as my_role,
           (select count(*)::int from space_members x where x.space_id = s.id) as member_count,
           (select count(*)::int from items x where x.space_id = s.id) as item_count
    from spaces s
    join space_members m on m.space_id = s.id and m.user_id = ${userId}
    ${spaceId ? sql`where s.id = ${spaceId}` : sql``}
    order by s.created_at, s.id
  `
}

// ── Items ───────────────────────────────────────────────────────────────────

export interface ItemRow {
  id: string
  space_id: string
  url: string
  title: string
  source_type: string
  shared_at: Date
  updated_at: Date
  status: string
  sb_id: string
  sb_name: string
  sb_avatar: string | null
  v_id: string
  v_number: number
  v_char_count: number
  v_hash: string
  v_captured_at: Date
  cb_id: string
  cb_name: string
  cb_avatar: string | null
  version_count: number
}

export interface ItemDetailRow extends ItemRow {
  markdown: string
  extractor: string
  lang: string | null
}

export function toItem(r: ItemRow): Item {
  return {
    id: r.id,
    spaceId: r.space_id,
    url: r.url,
    title: r.title,
    sourceType: r.source_type as SourceType,
    sharedBy: userRef(r.sb_id, r.sb_name, r.sb_avatar),
    sharedAt: iso(r.shared_at),
    updatedAt: iso(r.updated_at),
    status: r.status as Item['status'],
    versionCount: r.version_count,
    currentVersion: {
      id: r.v_id,
      number: r.v_number,
      charCount: r.v_char_count,
      contentHash: r.v_hash,
      capturedAt: iso(r.v_captured_at),
      capturedBy: userRef(r.cb_id, r.cb_name, r.cb_avatar),
    },
  }
}

export function toItemDetail(r: ItemDetailRow): ItemDetail {
  return { ...toItem(r), markdown: r.markdown, extractor: r.extractor, lang: r.lang }
}

/** Items with their current version; `where` is a fragment over alias `i`. */
export function selectItems(sql: Sql, where: Fragment, detail = false) {
  return sql<ItemDetailRow[]>`
    select i.id, i.space_id, i.url, i.title, i.source_type, i.shared_at, i.updated_at, i.status,
           su.id as sb_id, su.name as sb_name, su.avatar_url as sb_avatar,
           v.id as v_id, v.number as v_number, v.char_count as v_char_count, v.content_hash as v_hash,
           v.captured_at as v_captured_at,
           cu.id as cb_id, cu.name as cb_name, cu.avatar_url as cb_avatar,
           (select count(*)::int from item_versions x where x.item_id = i.id) as version_count
           ${detail ? sql`, v.markdown, v.extractor, v.lang` : sql``}
    from items i
    join users su on su.id = i.shared_by
    join item_versions v on v.id = i.current_version_id
    join users cu on cu.id = v.captured_by
    where ${where}
    order by i.updated_at desc, i.id desc
  `
}

export interface VersionRow {
  id: string
  number: number
  char_count: number
  content_hash: string
  captured_at: Date
  cb_id: string
  cb_name: string
  cb_avatar: string | null
}

export function toVersionRef(r: VersionRow): ItemVersionRef {
  return {
    id: r.id,
    number: r.number,
    charCount: r.char_count,
    contentHash: r.content_hash,
    capturedAt: iso(r.captured_at),
    capturedBy: userRef(r.cb_id, r.cb_name, r.cb_avatar),
  }
}

// ── Threads ─────────────────────────────────────────────────────────────────

export interface ThreadRow {
  id: string
  space_id: string
  visibility: string
  owner_id: string
  owner_name: string
  owner_avatar: string | null
  title: string
  created_at: Date
  last_message_at: Date | null
}

export function toThread(r: ThreadRow): Thread {
  return {
    id: r.id,
    spaceId: r.space_id,
    visibility: r.visibility as ThreadVisibility,
    owner: userRef(r.owner_id, r.owner_name, r.owner_avatar),
    title: r.title,
    createdAt: iso(r.created_at),
    lastMessageAt: r.last_message_at ? iso(r.last_message_at) : null,
  }
}

export function selectThreads(sql: Sql, where: Fragment) {
  return sql<ThreadRow[]>`
    select t.id, t.space_id, t.visibility, t.owner_id, u.name as owner_name,
           u.avatar_url as owner_avatar, t.title, t.created_at, t.last_message_at
    from threads t join users u on u.id = t.owner_id
    where ${where}
    order by coalesce(t.last_message_at, t.created_at) desc, t.id desc
  `
}

// ── Messages ────────────────────────────────────────────────────────────────

/** A citation as stored in messages.citations: `available` is computed on read. */
export type StoredCitation = Omit<Citation, 'available'>

/**
 * The number a citation shows when its version no longer exists (the item was unshared, which deletes
 * its versions, before the citation recorded its number). Such a citation is unavailable, and an
 * unavailable citation is shown without name, date or version.
 */
export const UNKNOWN_VERSION_NUMBER = 1

/**
 * Version numbers of the given item versions, keyed by version id. A version only counts under the
 * item the citation names, so a citation cannot borrow another item's number.
 */
export async function versionNumbers(
  sql: Sql | TxSql,
  cited: { itemId: string; itemVersionId: string }[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (cited.length === 0) return out
  const rows = await sql<{ id: string; item_id: string; number: number }[]>`
    select id, item_id, number from item_versions
    where id = any(${[...new Set(cited.map((c) => c.itemVersionId))]}::uuid[])
  `
  const owner = new Map(rows.map((r) => [r.id, r]))
  for (const c of cited) {
    const row = owner.get(c.itemVersionId)
    if (row && row.item_id === c.itemId) out.set(c.itemVersionId, row.number)
  }
  return out
}

export interface MessageRow {
  id: string
  thread_id: string
  role: string
  author_id: string
  author_name: string
  author_avatar: string | null
  model_provider: string | null
  model_id: string | null
  content: string
  citations: StoredCitation[]
  status: string
  error_code: MessageErrorCode | null
  usage: TokenUsage | null
  created_at: Date
  attachments: PageAttachment[]
}

export function selectMessages(sql: Sql, where: Fragment, tail?: Fragment) {
  return sql<MessageRow[]>`
    select m.id, m.thread_id, m.role, m.author_id, u.name as author_name,
           u.avatar_url as author_avatar, m.model_provider, m.model_id, m.content, m.citations,
           m.status, m.error_code, m.usage, m.created_at,
           coalesce((
             select json_agg(json_build_object(
                      'url', a.url, 'title', a.title, 'sourceType', a.source_type,
                      'charCount', a.char_count) order by a.id)
             from message_attachments a where a.message_id = m.id
           ), '[]'::json) as attachments
    from messages m join users u on u.id = m.author_id
    where ${where}
    ${tail ?? sql`order by m.created_at, m.id`}
  `
}

/**
 * Map message rows, computing `Citation.available` from which cited items still exist. An unshared
 * item's quote is already emptied in storage; it is blanked here too in case a citation was written
 * after the scrub (an answer that finished while the item was being unshared).
 */
export async function toMessages(sql: Sql, rows: MessageRow[]): Promise<Message[]> {
  const cited = new Set<string>()
  // Citations written before versionNumber existed are completed from their item version.
  const legacy: StoredCitation[] = []
  for (const r of rows) {
    for (const c of r.citations) {
      cited.add(c.itemId)
      if (typeof c.versionNumber !== 'number') legacy.push(c)
    }
  }
  const legacyNumbers = await versionNumbers(sql, legacy)
  const existing = new Set<string>()
  if (cited.size > 0) {
    const found = await sql<{ id: string }[]>`
      select id from items where id = any(${[...cited]}::uuid[])
    `
    for (const f of found) existing.add(f.id)
  }
  return rows.map((r) => ({
    id: r.id,
    threadId: r.thread_id,
    role: r.role as Message['role'],
    author: userRef(r.author_id, r.author_name, r.author_avatar),
    model:
      r.model_provider && r.model_id
        ? { provider: r.model_provider as Provider, id: r.model_id }
        : null,
    content: r.content,
    citations: r.citations.map((c) => {
      const available = existing.has(c.itemId)
      const versionNumber =
        typeof c.versionNumber === 'number'
          ? c.versionNumber
          : (legacyNumbers.get(c.itemVersionId) ?? UNKNOWN_VERSION_NUMBER)
      return { ...c, versionNumber, quote: available ? c.quote : '', available }
    }),
    attachments: r.attachments,
    status: r.status as Message['status'],
    errorCode: r.error_code,
    usage: r.usage,
    // A streaming answer's stored content is empty until it settles: it covers no delta yet.
    // listMessages replaces both with the live text and its delta count.
    streamSeq: r.status === 'streaming' ? 0 : null,
    createdAt: iso(r.created_at),
  }))
}

export async function getMessage(sql: Sql, messageId: string): Promise<Message> {
  const [message] = await toMessages(sql, await selectMessages(sql, sql`m.id = ${messageId}`))
  if (!message) throw new Error(`message ${messageId} vanished`)
  return message
}

// ── Audit ───────────────────────────────────────────────────────────────────

export interface AuditRow {
  id: string
  space_id: string
  actor_id: string
  actor_name: string
  actor_avatar: string | null
  action: string
  target_type: string
  target_id: string
  target_title: string | null
  target_url: string | null
  at: Date
}

export function toAuditEvent(r: AuditRow): AuditEvent {
  return {
    id: r.id,
    spaceId: r.space_id,
    actor: userRef(r.actor_id, r.actor_name, r.actor_avatar),
    action: r.action as AuditEvent['action'],
    target: {
      type: r.target_type as AuditEvent['target']['type'],
      id: r.target_id,
      title: r.target_title,
      url: r.target_url,
    },
    at: iso(r.at),
  }
}
