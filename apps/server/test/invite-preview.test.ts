import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { INVITE_PAGE_SCRIPT } from '../src/routes/invite-page'
import { type Harness, page, startHarness } from './helpers/harness'

let h: Harness
beforeAll(async () => {
  h = await startHarness()
})
afterAll(() => h.close())

async function ownerWithInvite(label: string, email?: string) {
  const owner = await h.login(`${label}Owner`)
  const space = await h.ok(
    'createSpace',
    { body: { name: `${label} 企画`, hue: 'teal' } },
    owner.token,
  )
  const created = await h.ok(
    'createInvite',
    { params: { spaceId: space.id }, body: email ? { email } : {} },
    owner.token,
  )
  return { owner, space, created }
}

describe('previewInvite', () => {
  it('shows the Space, its size, who invited and until when, and joins nothing', async () => {
    const { owner, space, created } = await ownerWithInvite('Pv')
    await h.ok(
      'shareItem',
      {
        params: { spaceId: space.id },
        body: { page: page('https://example.com/p', 'secret body') },
      },
      owner.token,
    )
    const guest = await h.login('PvGuest')
    const preview = await h.ok('previewInvite', { body: { token: created.token } }, guest.token)
    expect(preview).toEqual({
      spaceName: 'Pv 企画',
      hue: 'teal',
      memberCount: 1,
      itemCount: 1,
      invitedBy: { id: owner.user.id, name: owner.user.name, avatarUrl: owner.user.avatarUrl },
      expiresAt: created.invite.expiresAt,
      emailRestricted: false,
    })
    expect(JSON.stringify(preview)).not.toContain('secret body')
    expect(JSON.stringify(preview)).not.toContain(space.id)
    // Still not a member, and the invite is still usable.
    await h.fails(
      'getSpace',
      { params: { spaceId: space.id } },
      guest.token,
      404,
      'space_not_found',
    )
    await h.ok('acceptInvite', { body: { token: created.token } }, guest.token)
  })

  it('says an email invite is restricted without revealing the address', async () => {
    const target = await h.login('PvTarget')
    const { created } = await ownerWithInvite('PvMail', target.user.email)
    const preview = await h.ok('previewInvite', { body: { token: created.token } }, target.token)
    expect(preview.emailRestricted).toBe(true)
    expect(JSON.stringify(preview)).not.toContain(target.user.email)
  })

  it('fails exactly as acceptInvite does', async () => {
    const both = async (token: string, caller: string, status: number, code: string) => {
      await h.fails('previewInvite', { body: { token } }, caller, status, code)
      await h.fails('acceptInvite', { body: { token } }, caller, status, code)
    }
    const guest = await h.login('PvBad')
    await both('x'.repeat(43), guest.token, 404, 'invite_not_found')

    const expired = await ownerWithInvite('PvExp')
    await h.sql`update invites set expires_at = now() - interval '1 minute' where id = ${expired.created.invite.id}`
    await both(expired.created.token, guest.token, 410, 'invite_expired')

    const revoked = await ownerWithInvite('PvRev')
    await h.ok(
      'revokeInvite',
      { params: { spaceId: revoked.space.id, inviteId: revoked.created.invite.id } },
      revoked.owner.token,
    )
    await both(revoked.created.token, guest.token, 410, 'invite_revoked')

    const used = await ownerWithInvite('PvUsed')
    await h.ok(
      'acceptInvite',
      { body: { token: used.created.token } },
      (await h.login('PvFirst')).token,
    )
    await both(used.created.token, guest.token, 410, 'invite_used')

    const mail = await ownerWithInvite('PvMis', 'someone.else@example.com')
    await both(mail.created.token, guest.token, 403, 'invite_email_mismatch')

    await h.fails(
      'previewInvite',
      { body: { token: used.created.token } },
      undefined,
      401,
      'unauthenticated',
    )
  })

  it('is rate-limited like acceptInvite', async () => {
    const limited = await startHarness({ env: { AUTH_RATE_LIMIT_PER_MINUTE: '3' } })
    try {
      const { token } = await limited.login('PvRate')
      const statuses: number[] = []
      for (let i = 0; i < 5; i++) {
        statuses.push(
          (await limited.call('previewInvite', { body: { token: 'y'.repeat(43) } }, token)).status,
        )
      }
      expect(statuses).toEqual([404, 404, 404, 429, 429])
    } finally {
      await limited.close()
    }
  })
})

describe('invite page', () => {
  it('is served at the invite URL path as a static page that may fetch nothing', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/invite' })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(r.headers['referrer-policy']).toBe('no-referrer')
    const csp = String(r.headers['content-security-policy'])
    expect(csp).toContain("default-src 'none'")
    expect(csp).not.toContain('connect-src')
    expect(csp).not.toContain('unsafe-inline')
    // The one inline script is the one the CSP allows.
    const scripts = [...r.body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '')
    expect(scripts).toHaveLength(1)
    const hash = createHash('sha256')
      .update(scripts[0] ?? '')
      .digest('base64')
    expect(csp).toContain(`'sha256-${hash}'`)
    for (const text of ['Tigerで開く', 'Open in Tiger', 'ブラウザです', 'is a browser']) {
      expect(r.body).toContain(text)
    }
    // No external resources: nothing on this page can carry the fragment anywhere.
    expect(r.body).not.toMatch(/\s(src|href)="(https?:)?\/\//)
    expect(INVITE_PAGE_SCRIPT).not.toMatch(
      /fetch|XMLHttpRequest|sendBeacon|WebSocket|location\.(href|assign|replace)\s*=/,
    )
  })

  function runPage(hash: string) {
    const el = () => {
      const attrs: Record<string, string> = { 'data-done': 'Copied' }
      const listeners: Record<string, () => void> = {}
      return {
        hidden: true,
        textContent: '',
        attrs,
        listeners,
        setAttribute: (k: string, v: string) => {
          attrs[k] = v
        },
        getAttribute: (k: string) => attrs[k] ?? null,
        addEventListener: (type: string, fn: () => void) => {
          listeners[type] = fn
        },
      }
    }
    const els = { invite: el(), broken: el(), open: el(), token: el(), copy: el() }
    const copied: string[] = []
    runInNewContext(INVITE_PAGE_SCRIPT, {
      location: { hash },
      document: { getElementById: (id: keyof typeof els) => els[id] },
      navigator: {
        clipboard: {
          writeText: (t: string) => {
            copied.push(t)
            return Promise.resolve()
          },
        },
      },
    })
    return { els, copied }
  }

  it('builds the tiger:// link and shows the token from the fragment', async () => {
    const token = 'AbC_def-123456789xyz'
    const { els, copied } = runPage(`#${token}`)
    expect(els.invite.hidden).toBe(false)
    expect(els.broken.hidden).toBe(true)
    expect(els.open.attrs.href).toBe(`tiger://invite/${token}`)
    expect(els.token.textContent).toBe(token)
    els.copy.listeners.click?.()
    await Promise.resolve()
    expect(copied).toEqual([token])
  })

  it('says the link is incomplete when the fragment holds no token', () => {
    for (const hash of ['', '#', '#short', '#bad token"><script>', '#%E0%A4%A']) {
      const { els } = runPage(hash)
      expect(els.broken.hidden).toBe(false)
      expect(els.invite.hidden).toBe(true)
      expect(els.open.attrs.href).toBeUndefined()
    }
  })
})
