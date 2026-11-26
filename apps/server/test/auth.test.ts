import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashToken } from '../src/auth/tokens'
import type { GoogleIdentity } from '../src/seams'
import { type Harness, startHarness } from './helpers/harness'

const googleTokens = new Map<string, GoogleIdentity>()
const fakeVerify = async (idToken: string) => {
  const identity = googleTokens.get(idToken)
  if (!identity) throw new Error('bad token')
  return identity
}

let h: Harness
beforeAll(async () => {
  h = await startHarness({ verifyGoogleIdToken: fakeVerify })
})
afterAll(() => h.close())

describe('dev login and sessions', () => {
  it('issues an opaque token and stores only its SHA-256', async () => {
    const { token, user } = await h.login('Aiko')
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const rows = await h.sql<{ token_hash: Buffer }[]>`
      select token_hash from sessions where user_id = ${user.id}
    `
    expect(rows).toHaveLength(1)
    expect(Buffer.compare(rows[0]?.token_hash ?? Buffer.alloc(0), hashToken(token))).toBe(0)
    const dump = JSON.stringify(await h.sql`select * from sessions`)
    expect(dump).not.toContain(token)
    const me = await h.ok('me', {}, token)
    expect(me.user).toEqual(user)
    expect(me.spaces).toEqual([])
  })

  it('reuses the account for the same email in any letter case', async () => {
    const a = await h.ok('authDev', { body: { email: 'Case@Example.com', name: 'Case' } })
    const b = await h.ok('authDev', { body: { email: 'case@example.com', name: 'Other' } })
    expect(b.user.id).toBe(a.user.id)
    expect(b.token).not.toBe(a.token)
  })

  it('rejects an expired session and deletes it', async () => {
    const { token } = await h.login('Expiring')
    await h.ok('me', {}, token)
    await h.sql`update sessions set expires_at = now() - interval '1 second' where token_hash = ${hashToken(token)}::bytea`
    await h.fails('me', {}, token, 401, 'unauthenticated')
    const left = await h.sql`select 1 from sessions where token_hash = ${hashToken(token)}::bytea`
    expect(left).toHaveLength(0)
  })

  it('sets expiry from SESSION_TTL_DAYS', async () => {
    const { token } = await h.login('Ttl')
    const [row] = await h.sql<{ days: number }[]>`
      select extract(epoch from expires_at - created_at)::float8 / 86400 as days
      from sessions where token_hash = ${hashToken(token)}::bytea
    `
    expect(row?.days).toBeCloseTo(h.config.sessionTtlDays, 3)
  })

  it('logs out by deleting the session', async () => {
    const { token } = await h.login('Leaving')
    await h.ok('authLogout', {}, token)
    await h.fails('me', {}, token, 401, 'unauthenticated')
  })

  it('updates name and locale', async () => {
    const { token } = await h.login('Renamer')
    const u = await h.ok('updateMe', { body: { name: 'Renamed', locale: 'en' } }, token)
    expect(u).toMatchObject({ name: 'Renamed', locale: 'en' })
    expect((await h.ok('me', {}, token)).user.name).toBe('Renamed')
  })
})

describe('google sign-in', () => {
  it('creates a user from a verified ID token and signs in again by subject', async () => {
    googleTokens.set('google-token-1', {
      sub: 'g-1',
      email: 'gina@example.com',
      emailVerified: true,
      name: 'Gina',
      picture: 'https://example.com/g.png',
    })
    const first = await h.ok('authGoogle', { body: { idToken: 'google-token-1' } })
    expect(first.user).toMatchObject({
      email: 'gina@example.com',
      name: 'Gina',
      avatarUrl: 'https://example.com/g.png',
    })
    const second = await h.ok('authGoogle', { body: { idToken: 'google-token-1' } })
    expect(second.user.id).toBe(first.user.id)
  })

  it('links an existing account with the same email', async () => {
    const dev = await h.ok('authDev', { body: { email: 'linked@example.com', name: 'Linked' } })
    googleTokens.set('google-token-2', {
      sub: 'g-2',
      email: 'LINKED@example.com',
      emailVerified: true,
      name: 'Linked G',
      picture: null,
    })
    const g = await h.ok('authGoogle', { body: { idToken: 'google-token-2' } })
    expect(g.user.id).toBe(dev.user.id)
  })

  it('rejects invalid tokens and unverified emails', async () => {
    await h.fails(
      'authGoogle',
      { body: { idToken: 'not-a-known-token' } },
      undefined,
      401,
      'google_token_invalid',
    )
    googleTokens.set('google-token-3', {
      sub: 'g-3',
      email: 'unverified@example.com',
      emailVerified: false,
      name: null,
      picture: null,
    })
    await h.fails(
      'authGoogle',
      { body: { idToken: 'google-token-3' } },
      undefined,
      401,
      'google_token_invalid',
    )
  })
})

describe('disabled sign-in paths and rate limits', () => {
  let off: Harness
  beforeAll(async () => {
    off = await startHarness({ env: { AUTH_DEV_LOGIN: '0', AUTH_RATE_LIMIT_PER_MINUTE: '3' } })
  })
  afterAll(() => off.close())

  it('hides dev login unless AUTH_DEV_LOGIN=1 and reports Google as unconfigured', async () => {
    await off.fails(
      'authDev',
      { body: { email: 'x@example.com', name: 'X' } },
      undefined,
      404,
      'dev_login_disabled',
    )
    await off.fails(
      'authGoogle',
      { body: { idToken: 'whatever-token' } },
      undefined,
      503,
      'google_auth_unavailable',
    )
  })

  it('rate-limits unauthenticated routes per client', async () => {
    // Two calls above already counted against authDev/authGoogle; exhaust authGoogle's window.
    const codes: number[] = []
    for (let i = 0; i < 4; i++) {
      const r = await off.call('authGoogle', { body: { idToken: 'whatever-token' } })
      codes.push(r.status)
    }
    expect(codes).toContain(429)
    const r = await off.call('authGoogle', { body: { idToken: 'whatever-token' } })
    expect(r).toEqual({
      status: 429,
      body: { error: { code: 'rate_limited', message: expect.any(String) } },
    })
  })
})
