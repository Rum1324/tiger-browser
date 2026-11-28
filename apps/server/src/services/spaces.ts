import type { Invite, InvitePreview, Space, SpaceHue, SpaceMember, User } from '@tiger/shared'
import { generateToken, hashToken } from '../auth/tokens'
import type { AppContext } from '../context'
import type { Fragment, Sql, TxSql } from '../db/sql'
import { AppError, notFound } from '../errors'
import { newId } from '../ids'
import { requireMember, requireOwner } from './access'
import { appendAudit } from './audit'
import { iso, selectSpaces, toSpace, userRef } from './rows'

export const INVITE_TTL_DAYS = 14

export async function listSpaces(sql: Sql, userId: string): Promise<Space[]> {
  return (await selectSpaces(sql, userId)).map(toSpace)
}

export async function getSpaceFor(sql: Sql, spaceId: string, userId: string): Promise<Space> {
  const row = (await selectSpaces(sql, userId, spaceId))[0]
  if (!row) throw notFound('space_not_found', 'Space')
  return toSpace(row)
}

export async function createSpace(
  ctx: AppContext,
  user: User,
  input: { name: string; hue?: SpaceHue },
): Promise<Space> {
  const id = newId()
  const actor = userRef(user.id, user.name, user.avatarUrl)
  await ctx.sql.begin(async (tx) => {
    await tx`
      insert into spaces (id, name, hue, created_by, token_budget)
      values (${id}, ${input.name}, ${input.hue ?? 'amber'}, ${user.id}, ${ctx.config.spaceTokenBudget})
    `
    await tx`insert into space_members (space_id, user_id, role) values (${id}, ${user.id}, 'owner')`
    await appendAudit(tx, {
      spaceId: id,
      actor,
      action: 'space.created',
      target: { type: 'space', id, title: input.name, url: null },
    })
  })
  return getSpaceFor(ctx.sql, id, user.id)
}

export async function updateSpace(
  ctx: AppContext,
  user: User,
  spaceId: string,
  patch: { name?: string; hue?: SpaceHue },
): Promise<Space> {
  await requireOwner(ctx.sql, spaceId, user.id)
  await ctx.sql`
    update spaces set name = coalesce(${patch.name ?? null}, name), hue = coalesce(${patch.hue ?? null}, hue)
    where id = ${spaceId}
  `
  const space = await getSpaceFor(ctx.sql, spaceId, user.id)
  ctx.hub.publishToSpace(spaceId, {
    type: 'space.updated',
    spaceId,
    name: space.name,
    hue: space.hue,
  })
  return space
}

export async function listMembers(sql: Sql, spaceId: string): Promise<SpaceMember[]> {
  const rows = await sql<
    {
      id: string
      name: string
      avatar_url: string | null
      email: string
      role: 'owner' | 'member'
      joined_at: Date
    }[]
  >`
    select u.id, u.name, u.avatar_url, u.email, m.role, m.joined_at
    from space_members m join users u on u.id = m.user_id
    where m.space_id = ${spaceId}
    order by m.joined_at, u.id
  `
  return rows.map((r) => ({
    user: { id: r.id, name: r.name, avatarUrl: r.avatar_url, email: r.email },
    role: r.role,
    joinedAt: iso(r.joined_at),
  }))
}

interface InviteRow {
  id: string
  space_id: string
  email: string | null
  created_at: Date
  expires_at: Date
  accepted_at: Date | null
  cb_id: string
  cb_name: string
  cb_avatar: string | null
}

const toInvite = (r: InviteRow): Invite => ({
  id: r.id,
  spaceId: r.space_id,
  email: r.email,
  createdBy: userRef(r.cb_id, r.cb_name, r.cb_avatar),
  createdAt: iso(r.created_at),
  expiresAt: iso(r.expires_at),
  acceptedAt: r.accepted_at ? iso(r.accepted_at) : null,
})

function selectInvites(sql: Sql, where: Fragment) {
  return sql<InviteRow[]>`
    select i.id, i.space_id, i.email, i.created_at, i.expires_at, i.accepted_at,
           u.id as cb_id, u.name as cb_name, u.avatar_url as cb_avatar
    from invites i join users u on u.id = i.created_by
    where ${where}
    order by i.created_at desc, i.id desc
  `
}

export async function getSpaceDetail(sql: Sql, spaceId: string, userId: string) {
  const space = await getSpaceFor(sql, spaceId, userId)
  const members = await listMembers(sql, spaceId)
  // Invitee emails are for owners, who manage invites; members see the roster only.
  const pendingInvites =
    space.myRole === 'owner'
      ? (
          await selectInvites(
            sql,
            sql`i.space_id = ${spaceId} and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()`,
          )
        ).map(toInvite)
      : []
  return { space, members, pendingInvites }
}

export async function createInvite(
  ctx: AppContext,
  user: User,
  spaceId: string,
  email: string | null,
): Promise<{ invite: Invite; token: string; url: string }> {
  await requireOwner(ctx.sql, spaceId, user.id)
  const id = newId()
  const token = generateToken()
  const event = await ctx.sql.begin(async (tx) => {
    await tx`
      insert into invites (id, space_id, token_hash, email, created_by, expires_at)
      values (${id}, ${spaceId}, ${hashToken(token)}::bytea, ${email}, ${user.id},
              now() + make_interval(days => ${INVITE_TTL_DAYS}::int))
    `
    return appendAudit(tx, {
      spaceId,
      actor: userRef(user.id, user.name, user.avatarUrl),
      action: 'member.invited',
      // Every member reads the audit log; invitee emails are for owners (see getSpaceDetail).
      target: { type: 'member', id, title: null, url: null },
    })
  })
  ctx.hub.publishToSpace(spaceId, { type: 'audit.appended', event })
  const invite = (await selectInvites(ctx.sql, ctx.sql`i.id = ${id}`))[0]
  if (!invite) throw new Error('invite vanished after insert')
  // The token rides in the fragment so it never reaches a web server's access log.
  return { invite: toInvite(invite), token, url: `${ctx.config.publicUrl}/invite#${token}` }
}

export async function revokeInvite(
  ctx: AppContext,
  user: User,
  spaceId: string,
  inviteId: string,
): Promise<void> {
  await requireOwner(ctx.sql, spaceId, user.id)
  const rows = await ctx.sql`
    update invites set revoked_at = now()
    where id = ${inviteId} and space_id = ${spaceId} and accepted_at is null and revoked_at is null
    returning id
  `
  if (rows.length === 0) throw notFound('invite_not_found', 'Invite')
}

interface InviteCheck {
  id: string
  spaceId: string
  /** The caller already belongs to the Space: accepting is a no-op that returns it. */
  alreadyMember: boolean
}

/**
 * The checks acceptInvite and previewInvite share, in the same order, so a preview fails exactly when
 * accepting would. Pass `forUpdate` inside the accepting transaction.
 */
async function checkInvite(
  sql: Sql | TxSql,
  user: User,
  token: string,
  forUpdate: boolean,
): Promise<InviteCheck> {
  const rows = await sql<
    {
      id: string
      space_id: string
      email: string | null
      expired: boolean
      accepted_at: Date | null
      revoked_at: Date | null
    }[]
  >`
    select id, space_id, email, expires_at <= now() as expired, accepted_at, revoked_at
    from invites where token_hash = ${hashToken(token)}::bytea
    ${forUpdate ? sql`for update` : sql``}
  `
  const inv = rows[0]
  if (!inv) throw notFound('invite_not_found', 'Invite')
  if (inv.revoked_at) throw new AppError(410, 'invite_revoked', 'This invite was revoked')
  const already = await sql`
    select 1 from space_members where space_id = ${inv.space_id} and user_id = ${user.id}
  `
  // A member opening a link to their own Space must not burn the invite meant for someone else,
  // and the second request of a double-click finds the first one's membership: both get the Space.
  if (already.length > 0) return { id: inv.id, spaceId: inv.space_id, alreadyMember: true }
  if (inv.accepted_at) throw new AppError(410, 'invite_used', 'This invite was already used')
  if (inv.expired) throw new AppError(410, 'invite_expired', 'This invite has expired')
  if (inv.email && inv.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new AppError(403, 'invite_email_mismatch', 'This invite is for a different email address')
  }
  return { id: inv.id, spaceId: inv.space_id, alreadyMember: false }
}

/**
 * What the invited member sees before joining: the Space's name, colour and size, who invited them
 * and until when. Nothing of the Space's content, and nothing at all for a token accepting would refuse.
 */
export async function previewInvite(
  ctx: AppContext,
  user: User,
  token: string,
): Promise<InvitePreview> {
  const check = await checkInvite(ctx.sql, user, token, false)
  const [row] = await ctx.sql<
    {
      name: string
      hue: SpaceHue
      members: number
      items: number
      expires_at: Date
      email: string | null
      cb_id: string
      cb_name: string
      cb_avatar: string | null
    }[]
  >`
    select s.name, s.hue,
           (select count(*)::int from space_members m where m.space_id = s.id) as members,
           (select count(*)::int from items i where i.space_id = s.id) as items,
           inv.expires_at, inv.email, u.id as cb_id, u.name as cb_name, u.avatar_url as cb_avatar
    from invites inv
    join spaces s on s.id = inv.space_id
    join users u on u.id = inv.created_by
    where inv.id = ${check.id}
  `
  if (!row) throw notFound('invite_not_found', 'Invite')
  return {
    spaceName: row.name,
    hue: row.hue,
    memberCount: row.members,
    itemCount: row.items,
    invitedBy: userRef(row.cb_id, row.cb_name, row.cb_avatar),
    expiresAt: iso(row.expires_at),
    emailRestricted: row.email !== null,
  }
}

export async function acceptInvite(ctx: AppContext, user: User, token: string): Promise<Space> {
  const result = await ctx.sql.begin(async (tx) => {
    const check = await checkInvite(tx, user, token, true)
    if (check.alreadyMember) return { spaceId: check.spaceId, event: null }
    // Two different invites to this Space accepted at once: the second insert finds the first
    // one's row (after it commits) and inserts nothing; that invite is left unused.
    const joined = await tx`
      insert into space_members (space_id, user_id, role) values (${check.spaceId}, ${user.id}, 'member')
      on conflict do nothing
      returning user_id
    `
    if (joined.length === 0) return { spaceId: check.spaceId, event: null }
    await tx`update invites set accepted_at = now(), accepted_by = ${user.id} where id = ${check.id}`
    const event = await appendAudit(tx, {
      spaceId: check.spaceId,
      actor: userRef(user.id, user.name, user.avatarUrl),
      action: 'member.joined',
      target: { type: 'member', id: user.id, title: user.name, url: null },
    })
    return { spaceId: check.spaceId, event }
  })
  if (result.event) {
    const ref = userRef(user.id, user.name, user.avatarUrl)
    ctx.hub.publishToSpace(result.spaceId, {
      type: 'member.joined',
      spaceId: result.spaceId,
      user: ref,
    })
    ctx.hub.publishToSpace(result.spaceId, { type: 'audit.appended', event: result.event })
  }
  return getSpaceFor(ctx.sql, result.spaceId, user.id)
}

/** An owner removes anyone; any member may remove themselves (leave). The last owner cannot go. */
export async function removeMember(
  ctx: AppContext,
  user: User,
  spaceId: string,
  targetUserId: string,
): Promise<void> {
  const role = await requireMember(ctx.sql, spaceId, user.id)
  if (targetUserId !== user.id && role !== 'owner') {
    throw new AppError(403, 'forbidden', 'Only a Space owner can remove other members')
  }
  const event = await ctx.sql.begin(async (tx) => {
    const members = await tx<
      { user_id: string; role: string; name: string; avatar_url: string | null }[]
    >`
      select m.user_id, m.role, u.name, u.avatar_url
      from space_members m join users u on u.id = m.user_id
      where m.space_id = ${spaceId}
      for update of m
    `
    const target = members.find((m) => m.user_id === targetUserId)
    if (!target) throw notFound('member_not_found', 'Member')
    if (target.role === 'owner' && members.filter((m) => m.role === 'owner').length === 1) {
      throw new AppError(409, 'last_owner', 'A Space needs at least one owner')
    }
    await tx`delete from space_members where space_id = ${spaceId} and user_id = ${targetUserId}`
    return appendAudit(tx, {
      spaceId,
      actor: userRef(user.id, user.name, user.avatarUrl),
      action: 'member.removed',
      target: { type: 'member', id: targetUserId, title: target.name, url: null },
    })
  })
  // Published before the removed member's sockets are dropped, so they learn they were removed.
  ctx.hub.publishToSpace(spaceId, { type: 'member.removed', spaceId, userId: targetUserId })
  ctx.hub.publishToSpace(spaceId, { type: 'audit.appended', event })
  ctx.hub.dropMembership(spaceId, targetUserId)
}
