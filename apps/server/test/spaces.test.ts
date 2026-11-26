import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashToken } from '../src/auth/tokens'
import { type Harness, startHarness } from './helpers/harness'

let h: Harness
beforeAll(async () => {
  h = await startHarness({ env: { SPACE_TOKEN_BUDGET: '100000' } })
})
afterAll(() => h.close())

async function ownerWithSpace(name = 'Owner') {
  const owner = await h.login(name)
  const space = await h.ok(
    'createSpace',
    { body: { name: `${name}'s space`, hue: 'teal' } },
    owner.token,
  )
  return { owner, space }
}

async function invite(spaceId: string, token: string, email?: string) {
  return h.ok('createInvite', { params: { spaceId }, body: email ? { email } : {} }, token)
}

describe('spaces', () => {
  it('makes the creator the owner and lists the Space for them only', async () => {
    const { owner, space } = await ownerWithSpace()
    expect(space).toMatchObject({
      hue: 'teal',
      myRole: 'owner',
      memberCount: 1,
      itemCount: 0,
      createdBy: owner.user.id,
    })
    expect((await h.ok('listSpaces', {}, owner.token)).map((s) => s.id)).toEqual([space.id])
    const other = await h.login('Other')
    expect(await h.ok('listSpaces', {}, other.token)).toEqual([])
    const detail = await h.ok('getSpace', { params: { spaceId: space.id } }, owner.token)
    const { locale: _locale, ...ownerRef } = owner.user
    expect(detail.members).toEqual([
      { user: ownerRef, role: 'owner', joinedAt: expect.any(String) },
    ])
    const [row] = await h.sql<
      { token_budget: string }[]
    >`select token_budget::text from spaces where id = ${space.id}`
    expect(row?.token_budget).toBe('100000')
    const audit = await h.ok('listAudit', { params: { spaceId: space.id }, query: {} }, owner.token)
    expect(audit.map((a) => a.action)).toEqual(['space.created'])
  })

  it('lets only owners rename a Space', async () => {
    const { owner, space } = await ownerWithSpace()
    const renamed = await h.ok(
      'updateSpace',
      { params: { spaceId: space.id }, body: { name: 'Renamed' } },
      owner.token,
    )
    expect(renamed).toMatchObject({ name: 'Renamed', hue: 'teal' })
    const member = await h.login('Member')
    await h.ok(
      'acceptInvite',
      { body: { token: (await invite(space.id, owner.token)).token } },
      member.token,
    )
    await h.fails(
      'updateSpace',
      { params: { spaceId: space.id }, body: { name: 'X' } },
      member.token,
      403,
      'forbidden',
    )
  })
})

describe('invites', () => {
  it('shows the token once, stores its hash, and turns the invitee into a member', async () => {
    const { owner, space } = await ownerWithSpace()
    const created = await invite(space.id, owner.token)
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(created.url).toBe(`https://tiger.test/invite#${created.token}`)
    expect(created.invite).toMatchObject({
      spaceId: space.id,
      email: null,
      acceptedAt: null,
      createdBy: { id: owner.user.id },
    })
    const days =
      (Date.parse(created.invite.expiresAt) - Date.parse(created.invite.createdAt)) / 86_400_000
    expect(days).toBeCloseTo(14, 3)
    const [row] = await h.sql<
      { token_hash: Buffer }[]
    >`select token_hash from invites where id = ${created.invite.id}`
    expect(Buffer.compare(row?.token_hash ?? Buffer.alloc(0), hashToken(created.token))).toBe(0)
    expect(JSON.stringify(await h.sql`select * from invites`)).not.toContain(created.token)

    const pending = await h.ok('getSpace', { params: { spaceId: space.id } }, owner.token)
    expect(pending.pendingInvites.map((i) => i.id)).toEqual([created.invite.id])

    const guest = await h.login('Guest')
    const joined = await h.ok('acceptInvite', { body: { token: created.token } }, guest.token)
    expect(joined).toMatchObject({ id: space.id, myRole: 'member', memberCount: 2 })
    const after = await h.ok('getSpace', { params: { spaceId: space.id } }, owner.token)
    expect(after.pendingInvites).toEqual([])
    expect(after.members.map((m) => m.user.id)).toEqual([owner.user.id, guest.user.id])
    // Members see the roster but not invitee emails.
    expect(
      (await h.ok('getSpace', { params: { spaceId: space.id } }, guest.token)).pendingInvites,
    ).toEqual([])
    const audit = await h.ok(
      'listAudit',
      { params: { spaceId: space.id }, query: { limit: 10 } },
      owner.token,
    )
    expect(audit.map((a) => a.action)).toEqual(['member.joined', 'member.invited', 'space.created'])
  })

  it('refuses reuse by someone else', async () => {
    const { owner, space } = await ownerWithSpace()
    const { token } = await invite(space.id, owner.token)
    const first = await h.login('First')
    await h.ok('acceptInvite', { body: { token } }, first.token)
    const second = await h.login('Second')
    await h.fails('acceptInvite', { body: { token } }, second.token, 410, 'invite_used')
    expect(await h.ok('listSpaces', {}, second.token)).toEqual([])
  })

  it('refuses an expired invite', async () => {
    const { owner, space } = await ownerWithSpace()
    const created = await invite(space.id, owner.token)
    await h.sql`update invites set expires_at = now() - interval '1 minute' where id = ${created.invite.id}`
    const late = await h.login('Late')
    await h.fails(
      'acceptInvite',
      { body: { token: created.token } },
      late.token,
      410,
      'invite_expired',
    )
    expect(
      (await h.ok('getSpace', { params: { spaceId: space.id } }, owner.token)).pendingInvites,
    ).toEqual([])
  })

  it('refuses a revoked invite, and revoking twice is a 404', async () => {
    const { owner, space } = await ownerWithSpace()
    const created = await invite(space.id, owner.token)
    await h.ok(
      'revokeInvite',
      { params: { spaceId: space.id, inviteId: created.invite.id } },
      owner.token,
    )
    await h.fails(
      'revokeInvite',
      { params: { spaceId: space.id, inviteId: created.invite.id } },
      owner.token,
      404,
      'invite_not_found',
    )
    const someone = await h.login('Someone')
    await h.fails(
      'acceptInvite',
      { body: { token: created.token } },
      someone.token,
      410,
      'invite_revoked',
    )
  })

  it('accepts an email invite only from that email', async () => {
    const { owner, space } = await ownerWithSpace()
    const target = await h.login('Target')
    const created = await invite(space.id, owner.token, target.user.email.toUpperCase())
    const wrong = await h.login('Wrong')
    await h.fails(
      'acceptInvite',
      { body: { token: created.token } },
      wrong.token,
      403,
      'invite_email_mismatch',
    )
    const joined = await h.ok('acceptInvite', { body: { token: created.token } }, target.token)
    expect(joined.myRole).toBe('member')
  })

  it('rejects unknown tokens and does not burn an invite opened by an existing member', async () => {
    const { owner, space } = await ownerWithSpace()
    await h.fails(
      'acceptInvite',
      { body: { token: 'x'.repeat(43) } },
      owner.token,
      404,
      'invite_not_found',
    )
    const { token } = await invite(space.id, owner.token)
    await h.ok('acceptInvite', { body: { token } }, owner.token)
    const real = await h.login('Real')
    expect((await h.ok('acceptInvite', { body: { token } }, real.token)).myRole).toBe('member')
  })

  it('lets only owners invite and revoke', async () => {
    const { owner, space } = await ownerWithSpace()
    const member = await h.login('Plain')
    await h.ok(
      'acceptInvite',
      { body: { token: (await invite(space.id, owner.token)).token } },
      member.token,
    )
    await h.fails(
      'createInvite',
      { params: { spaceId: space.id }, body: {} },
      member.token,
      403,
      'forbidden',
    )
    const created = await invite(space.id, owner.token)
    await h.fails(
      'revokeInvite',
      { params: { spaceId: space.id, inviteId: created.invite.id } },
      member.token,
      403,
      'forbidden',
    )
  })
})

describe('members', () => {
  it('lets an owner remove a member, a member leave, and never the last owner', async () => {
    const { owner, space } = await ownerWithSpace()
    const a = await h.login('A')
    const b = await h.login('B')
    for (const u of [a, b]) {
      await h.ok(
        'acceptInvite',
        { body: { token: (await invite(space.id, owner.token)).token } },
        u.token,
      )
    }
    await h.fails(
      'removeMember',
      { params: { spaceId: space.id, userId: b.user.id } },
      a.token,
      403,
      'forbidden',
    )
    await h.ok('removeMember', { params: { spaceId: space.id, userId: a.user.id } }, a.token)
    await h.fails('getSpace', { params: { spaceId: space.id } }, a.token, 404, 'space_not_found')
    await h.ok('removeMember', { params: { spaceId: space.id, userId: b.user.id } }, owner.token)
    await h.fails(
      'removeMember',
      { params: { spaceId: space.id, userId: b.user.id } },
      owner.token,
      404,
      'member_not_found',
    )
    await h.fails(
      'removeMember',
      { params: { spaceId: space.id, userId: owner.user.id } },
      owner.token,
      409,
      'last_owner',
    )
    const audit = await h.ok('listAudit', { params: { spaceId: space.id }, query: {} }, owner.token)
    expect(audit.filter((e) => e.action === 'member.removed').map((e) => e.target.id)).toEqual([
      b.user.id,
      a.user.id,
    ])
  })
})
