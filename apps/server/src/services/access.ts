import type { SpaceRole } from '@tiger/shared'
import type { Sql } from '../db/sql'
import { AppError, notFound } from '../errors'

/**
 * Access checks. A caller who is not a member gets the same 404 as for a Space, item or thread that
 * does not exist, so ids cannot be probed. A member who lacks a permission gets 403: they already know
 * the target exists.
 */

export async function memberRole(
  sql: Sql,
  spaceId: string,
  userId: string,
): Promise<SpaceRole | null> {
  const rows = await sql<{ role: SpaceRole }[]>`
    select role from space_members where space_id = ${spaceId} and user_id = ${userId}
  `
  return rows[0]?.role ?? null
}

export async function requireMember(sql: Sql, spaceId: string, userId: string): Promise<SpaceRole> {
  const role = await memberRole(sql, spaceId, userId)
  if (!role) throw notFound('space_not_found', 'Space')
  return role
}

export async function requireOwner(sql: Sql, spaceId: string, userId: string): Promise<void> {
  const role = await requireMember(sql, spaceId, userId)
  if (role !== 'owner') throw new AppError(403, 'forbidden', 'Only a Space owner can do this')
}

export interface ItemAccess {
  id: string
  spaceId: string
  sharedBy: string
  role: SpaceRole
}

export async function requireItemAccess(
  sql: Sql,
  itemId: string,
  userId: string,
): Promise<ItemAccess> {
  const rows = await sql<{ id: string; space_id: string; shared_by: string; role: SpaceRole }[]>`
    select i.id, i.space_id, i.shared_by, m.role
    from items i join space_members m on m.space_id = i.space_id and m.user_id = ${userId}
    where i.id = ${itemId}
  `
  const r = rows[0]
  if (!r) throw notFound('item_not_found', 'Item')
  return { id: r.id, spaceId: r.space_id, sharedBy: r.shared_by, role: r.role }
}

export interface ThreadAccess {
  id: string
  spaceId: string
  visibility: 'private' | 'space'
  ownerId: string
  title: string
  role: SpaceRole
}

/** Space threads are visible to members; a private thread only to its owner, who must still be a member. */
export async function requireThreadAccess(
  sql: Sql,
  threadId: string,
  userId: string,
): Promise<ThreadAccess> {
  const rows = await sql<
    {
      id: string
      space_id: string
      visibility: 'private' | 'space'
      owner_id: string
      title: string
      role: SpaceRole
    }[]
  >`
    select t.id, t.space_id, t.visibility, t.owner_id, t.title, m.role
    from threads t join space_members m on m.space_id = t.space_id and m.user_id = ${userId}
    where t.id = ${threadId} and (t.visibility = 'space' or t.owner_id = ${userId})
  `
  const r = rows[0]
  if (!r) throw notFound('thread_not_found', 'Thread')
  return {
    id: r.id,
    spaceId: r.space_id,
    visibility: r.visibility,
    ownerId: r.owner_id,
    title: r.title,
    role: r.role,
  }
}
