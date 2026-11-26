import { describe, expect, it } from 'vitest'
import { captureEligibility, sourceTypeForUrl } from '../src/blocklist'

const open = { incognito: false }

describe('captureEligibility', () => {
  it('allows ordinary work pages', () => {
    for (const url of [
      'https://docs.google.com/document/d/abc123/edit',
      'https://www.notion.so/yindustries/Roadmap-1a2b',
      'https://app.slack.com/client/T01/C02',
      'https://www.nikkei.com/article/DGXZQOUC123',
      'https://example.co.jp/blog/2026/11/pitch',
    ]) {
      expect(captureEligibility(url, open), url).toEqual({
        allowed: true,
        reason: null,
        rule: null,
      })
    }
  })

  it('blocks everything in an incognito tab, whatever the URL', () => {
    const r = captureEligibility('https://docs.google.com/document/d/abc/edit', { incognito: true })
    expect(r).toMatchObject({ allowed: false, reason: 'incognito' })
  })

  it('blocks banking by host suffix on a label boundary', () => {
    expect(captureEligibility('https://direct.bk.mufg.jp/ib/top', open)).toMatchObject({
      allowed: false,
      reason: 'banking',
      rule: 'mufg.jp',
    })
    expect(captureEligibility('https://www.rakuten-bank.co.jp/', open).reason).toBe('banking')
    // A different registrable domain that merely ends with the same letters is not the bank.
    expect(captureEligibility('https://notmufg.jp/article', open).allowed).toBe(true)
  })

  it('blocks webmail, including mail under a path', () => {
    expect(captureEligibility('https://mail.google.com/mail/u/0/#inbox', open).reason).toBe('email')
    expect(captureEligibility('https://outlook.office.com/mail/inbox', open).reason).toBe('email')
    expect(captureEligibility('https://www.icloud.com/mail/', open).reason).toBe('email')
    expect(captureEligibility('https://www.icloud.com/pages/', open).allowed).toBe(true)
  })

  it('blocks password managers and identity providers', () => {
    expect(captureEligibility('https://my.1password.com/vaults/all', open).reason).toBe(
      'password-manager',
    )
    expect(captureEligibility('https://vault.bitwarden.com/#/vault', open).reason).toBe(
      'password-manager',
    )
    expect(
      captureEligibility('https://accounts.google.com/v3/signin/identifier', open).reason,
    ).toBe('auth')
  })

  it('blocks sign-in paths on any site but not documentation about sign-in', () => {
    expect(captureEligibility('https://github.com/login', open).reason).toBe('auth')
    expect(captureEligibility('https://app.example.com/users/sign_in', open).reason).toBe('auth')
    expect(captureEligibility('https://example.com/oauth/authorize?client_id=1', open).reason).toBe(
      'auth',
    )
    expect(
      captureEligibility('https://developers.google.com/identity/protocols/oauth2', open).allowed,
    ).toBe(true)
    expect(captureEligibility('https://example.com/docs/login', open).allowed).toBe(true)
    expect(captureEligibility('https://example.com/blog/password-hygiene', open).allowed).toBe(true)
  })

  it('blocks non-web schemes and local network hosts', () => {
    expect(captureEligibility('file:///Users/sota/secret.pdf', open).reason).toBe('scheme')
    expect(captureEligibility('about:blank', open).reason).toBe('scheme')
    expect(captureEligibility('not a url', open).reason).toBe('scheme')
    expect(captureEligibility('http://localhost:3000/admin', open).reason).toBe('local-network')
    expect(captureEligibility('http://192.168.1.10/router', open).reason).toBe('local-network')
    expect(captureEligibility('http://172.20.0.5/', open).reason).toBe('local-network')
    expect(captureEligibility('http://172.32.0.5/', open).allowed).toBe(true)
    expect(captureEligibility('https://wiki.corp.internal/page', open).reason).toBe('local-network')
  })

  it('applies host rules the member added', () => {
    const ctx = { incognito: false, userBlockedHosts: ['Example-Clinic.jp '] }
    expect(captureEligibility('https://portal.example-clinic.jp/results', ctx)).toMatchObject({
      allowed: false,
      reason: 'user-rule',
      rule: 'example-clinic.jp',
    })
  })
})

describe('sourceTypeForUrl', () => {
  it('classifies the apps the team uses', () => {
    expect(sourceTypeForUrl('https://docs.google.com/document/d/1/edit')).toBe('google-doc')
    expect(sourceTypeForUrl('https://docs.google.com/spreadsheets/d/1/edit')).toBe('google-sheet')
    expect(sourceTypeForUrl('https://docs.google.com/presentation/d/1/edit')).toBe('google-slides')
    expect(sourceTypeForUrl('https://yindustries.slack.com/archives/C1/p1')).toBe('slack')
    expect(sourceTypeForUrl('https://www.notion.so/page-1')).toBe('notion')
    expect(sourceTypeForUrl('https://example.com/files/deck.PDF')).toBe('pdf')
    expect(sourceTypeForUrl('https://example.com/')).toBe('web')
    expect(sourceTypeForUrl('about:blank')).toBe('other')
  })
})

describe('local network detection', () => {
  const blocked = (url: string) => captureEligibility(url, { incognito: false }).reason

  it('treats mapped, unspecified, CGNAT and single-label hosts as local', () => {
    for (const url of [
      'http://[::ffff:192.168.1.1]/',
      'http://[::ffff:10.0.0.8]/',
      'http://0.0.0.0:8080/',
      'http://100.101.1.2/',
      'http://intranet/',
      'http://wiki/page',
      'https://box.tailnet-1234.ts.net/',
      'http://printer.home.arpa/',
      'http://[::]/',
    ]) {
      expect(blocked(url), url).toBe('local-network')
    }
  })

  it('leaves public addresses alone, including mapped ones', () => {
    for (const url of [
      'http://[::ffff:8.8.8.8]/',
      'http://100.128.0.1/',
      'http://8.8.8.8/',
      'https://example.com/',
    ]) {
      expect(captureEligibility(url, { incognito: false }).allowed, url).toBe(true)
    }
  })
})
