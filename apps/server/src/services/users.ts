import type { Locale, User } from '@tiger/shared'
import type { Sql } from '../db/sql'
import { AppError } from '../errors'
import { newId } from '../ids'
import type { GoogleIdentity } from '../seams'
import { toUser, type UserRow } from './rows'

const USER_COLS = 'id, email, name, avatar_url, locale'

/** Dev login: the email is the identity. */
export async function upsertUserByEmail(sql: Sql, email: string, name: string): Promise<User> {
  const rows = await sql<UserRow[]>`
    insert into users (id, email, name) values (${newId()}, ${email}, ${name})
    on conflict ((lower(email))) do update set email = users.email
    returning ${sql.unsafe(USER_COLS)}
  `
  const row = rows[0]
  if (!row) throw new Error('user upsert returned no row')
  return toUser(row)
}

/**
 * Google sign-in: match by Google subject first, then link an existing account with the same verified
 * email (for example one created by an email invite or dev login), else create the user.
 */
export async function upsertGoogleUser(sql: Sql, g: GoogleIdentity): Promise<User> {
  return sql.begin(async (tx) => {
    const bySub = await tx<UserRow[]>`
      update users set avatar_url = coalesce(${g.picture}, avatar_url)
      where google_sub = ${g.sub}
      returning ${tx.unsafe(USER_COLS)}
    `
    if (bySub[0]) return toUser(bySub[0])
    const byEmail = await tx<UserRow[]>`
      update users set google_sub = ${g.sub}, avatar_url = coalesce(avatar_url, ${g.picture})
      where lower(email) = lower(${g.email}) and google_sub is null
      returning ${tx.unsafe(USER_COLS)}
    `
    if (byEmail[0]) return toUser(byEmail[0])
    const name = (g.name ?? g.email.split('@')[0] ?? g.email).slice(0, 120) || g.email.slice(0, 120)
    const created = await tx<UserRow[]>`
      insert into users (id, email, name, avatar_url, google_sub)
      values (${newId()}, ${g.email}, ${name}, ${g.picture}, ${g.sub})
      on conflict do nothing
      returning ${tx.unsafe(USER_COLS)}
    `
    // The email already belongs to an account linked to a different Google subject.
    if (!created[0])
      throw new AppError(409, 'forbidden', 'This email is linked to another Google account')
    return toUser(created[0])
  })
}

export async function updateUser(
  sql: Sql,
  userId: string,
  patch: { name?: string; locale?: Locale },
): Promise<User> {
  const rows = await sql<UserRow[]>`
    update users set
      name = coalesce(${patch.name ?? null}, name),
      locale = coalesce(${patch.locale ?? null}, locale)
    where id = ${userId}
    returning ${sql.unsafe(USER_COLS)}
  `
  if (!rows[0]) throw new Error('signed-in user vanished')
  return toUser(rows[0])
}
