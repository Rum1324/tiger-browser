import type { User } from '@tiger/shared'
import type { Sql } from '../db/sql'
import { toUser, type UserRow } from '../services/rows'
import { generateToken, hashToken } from './tokens'

/** last_seen_at is refreshed at most this often, so reads do not turn into a write per request. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000

export async function createSession(sql: Sql, userId: string, ttlDays: number): Promise<string> {
  const token = generateToken()
  await sql`
    insert into sessions (token_hash, user_id, expires_at)
    values (${hashToken(token)}::bytea, ${userId}, now() + make_interval(days => ${ttlDays}::int))
  `
  return token
}

export interface ResolvedSession {
  user: User
  tokenHash: Buffer
}

/** Returns null for unknown or expired tokens; expired rows are deleted on sight. */
export async function resolveSession(sql: Sql, token: string): Promise<ResolvedSession | null> {
  const tokenHash = hashToken(token)
  const rows = await sql<(UserRow & { expired: boolean; last_seen_at: Date })[]>`
    select u.id, u.email, u.name, u.avatar_url, u.locale,
           s.expires_at <= now() as expired, s.last_seen_at
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${tokenHash}::bytea
  `
  const row = rows[0]
  if (!row) return null
  if (row.expired) {
    await sql`delete from sessions where token_hash = ${tokenHash}::bytea`
    return null
  }
  if (Date.now() - row.last_seen_at.getTime() > TOUCH_INTERVAL_MS) {
    await sql`update sessions set last_seen_at = now() where token_hash = ${tokenHash}::bytea`
  }
  return { user: toUser(row), tokenHash }
}

export async function deleteSession(sql: Sql, tokenHash: Buffer): Promise<void> {
  await sql`delete from sessions where token_hash = ${tokenHash}::bytea`
}
