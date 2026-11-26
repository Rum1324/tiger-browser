import { request } from 'node:http'
import type { DatabaseSync } from 'node:sqlite'
import type { GoogleConnection } from '@tiger/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AUTH_TIMEOUT_MS,
  type FetchLike,
  fetchingOpener,
  GOOGLE_ENDPOINTS,
  type GoogleConfig,
  googleConfigFromEnv,
  wantsFetchOpener,
} from '../../src/main/google/config'
import { multipartBody, uploadUrl } from '../../src/main/google/drive'
import { GoogleAuthError } from '../../src/main/google/errors'
import { returnPage, startLoopback } from '../../src/main/google/loopback'
import { markdownToHtml } from '../../src/main/google/markdown-html'
import {
  authorizationUrl,
  authorize,
  DRIVE_FILE_SCOPE,
  emailFromIdToken,
} from '../../src/main/google/oauth'
import { createPkce, randomState, s256 } from '../../src/main/google/pkce'
import {
  classifyUpload,
  flowErrorOf,
  GoogleService,
  NOT_CONFIGURED,
} from '../../src/main/google/service'
import { KvStore, openDatabase } from '../../src/main/store/db'
import { type Cipher, TokenStore } from '../../src/main/store/token'
import { FakeGoogle, parseMultipart } from '../fake-google'

const JA_MARKDOWN = `# 四半期レポート

売上は**前年比 12%** 増加しました。

| 地域 | 売上 (百万円) |
| --- | ---: |
| 東京 | 120 |
| 大阪 | 85 |

- 次回の会議: 12月3日
`

/** Reversible stand-in for the OS keychain: proves only ciphertext reaches the database. */
const fakeCipher: Cipher = {
  isAvailable: async () => true,
  encrypt: async (plain) => Buffer.from(`sealed:${Buffer.from(plain).toString('base64')}`),
  decrypt: async (sealed) => {
    const s = sealed.toString()
    if (!s.startsWith('sealed:')) throw new Error('not sealed')
    return Buffer.from(s.slice(7), 'base64').toString()
  },
}

function errorCode(p: Promise<unknown>): Promise<string> {
  return p.then(
    () => 'resolved',
    (e) => (e instanceof GoogleAuthError ? e.code : `other: ${String(e)}`),
  )
}

/** A plain GET that returns status and body, or the connection error code. */
function get(url: string): Promise<{ status: number; body: string } | { error: string }> {
  return new Promise((resolve) => {
    const req = request(url, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => {
        body += c
      })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', (e: NodeJS.ErrnoException) => resolve({ error: e.code ?? e.message }))
    req.end()
  })
}

describe('PKCE and state', () => {
  it('computes the RFC 7636 appendix B challenge', () => {
    expect(s256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  it('makes a fresh 43-character verifier whose challenge is its S256 hash', () => {
    const a = createPkce()
    const b = createPkce()
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a.method).toBe('S256')
    expect(a.challenge).toBe(s256(a.verifier))
    expect(a.verifier).not.toBe(b.verifier)
    expect(randomState()).not.toBe(randomState())
    expect(randomState().length).toBeGreaterThanOrEqual(32)
  })
})

describe('configuration', () => {
  it('is absent without a client id', () => {
    expect(googleConfigFromEnv({}, { allowOverrides: true })).toBeNull()
    expect(
      googleConfigFromEnv({ TIGER_GOOGLE_CLIENT_ID: '  ' }, { allowOverrides: true }),
    ).toBeNull()
  })

  it('uses Google endpoints and ignores overrides in packaged builds', () => {
    const env = {
      TIGER_GOOGLE_CLIENT_ID: 'id',
      TIGER_GOOGLE_TOKEN_ENDPOINT: 'http://127.0.0.1:1/token',
      TIGER_GOOGLE_AUTH_TIMEOUT_MS: '50',
      TIGER_GOOGLE_TEST_OPENER: 'fetch',
    }
    const packaged = googleConfigFromEnv(env, { allowOverrides: false })
    expect(packaged).toEqual({
      clientId: 'id',
      clientSecret: null,
      endpoints: GOOGLE_ENDPOINTS,
      authTimeoutMs: DEFAULT_AUTH_TIMEOUT_MS,
    })
    expect(wantsFetchOpener(env, { allowOverrides: false })).toBe(false)
    const dev = googleConfigFromEnv(
      {
        ...env,
        TIGER_GOOGLE_CLIENT_SECRET: 's',
        TIGER_GOOGLE_REVOKE_ENDPOINT: 'javascript:alert(1)',
      },
      { allowOverrides: true },
    )
    expect(dev?.endpoints.token).toBe('http://127.0.0.1:1/token')
    expect(dev?.endpoints.revoke).toBe(GOOGLE_ENDPOINTS.revoke)
    expect(dev?.clientSecret).toBe('s')
    expect(dev?.authTimeoutMs).toBe(50)
    expect(wantsFetchOpener(env, { allowOverrides: true })).toBe(true)
  })
})

describe('authorization URL', () => {
  it('carries PKCE S256, state, the loopback redirect and offline access only when asked', () => {
    const config = googleConfigFromEnv(
      { TIGER_GOOGLE_CLIENT_ID: 'cid' },
      { allowOverrides: false },
    ) as GoogleConfig
    const base = { redirectUri: 'http://127.0.0.1:5555', state: 'st', challenge: 'ch' }
    const offline = new URL(
      authorizationUrl(config, {
        ...base,
        scopes: ['openid', 'email', DRIVE_FILE_SCOPE],
        offline: true,
      }),
    )
    expect(offline.origin + offline.pathname).toBe(GOOGLE_ENDPOINTS.authorize)
    const q = Object.fromEntries(offline.searchParams)
    expect(q).toEqual({
      client_id: 'cid',
      redirect_uri: 'http://127.0.0.1:5555',
      response_type: 'code',
      scope: `openid email ${DRIVE_FILE_SCOPE}`,
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      state: 'st',
      access_type: 'offline',
      prompt: 'consent',
    })
    const online = new URL(
      authorizationUrl(config, { ...base, scopes: ['openid'], offline: false }),
    )
    expect(online.searchParams.has('access_type')).toBe(false)
  })
})

describe('loopback listener', () => {
  it('accepts the redirect once, shows a bilingual page and closes', async () => {
    const loop = await startLoopback({ state: 'abc', timeoutMs: 5000 })
    expect(loop.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const favicon = await get(`${loop.redirectUri}/favicon.ico`)
    expect(favicon).toMatchObject({ status: 404 })
    const res = await get(`${loop.redirectUri}/?state=abc&code=the-code`)
    expect(res).toMatchObject({ status: 200 })
    const body = (res as { body: string }).body
    expect(body).toContain('Tiger に戻ってください')
    expect(body).toContain('You can return to Tiger')
    expect(body).not.toContain('the-code')
    expect(await loop.code).toBe('the-code')
    await new Promise((r) => setTimeout(r, 20))
    expect(await get(`${loop.redirectUri}/?state=abc&code=again`)).toEqual({
      error: 'ECONNREFUSED',
    })
  })

  it('rejects a state mismatch and stops listening', async () => {
    const loop = await startLoopback({ state: 'expected', timeoutMs: 5000 })
    const res = await get(`${loop.redirectUri}/?state=forged&code=c`)
    expect(res).toMatchObject({ status: 400 })
    expect((res as { body: string }).body).toContain('Return to Tiger and try again')
    expect(await errorCode(loop.code)).toBe('state-mismatch')
    await new Promise((r) => setTimeout(r, 20))
    expect(await get(`${loop.redirectUri}/?state=expected&code=c`)).toEqual({
      error: 'ECONNREFUSED',
    })
  })

  it('maps access_denied to denied', async () => {
    const loop = await startLoopback({ state: 's', timeoutMs: 5000 })
    await get(`${loop.redirectUri}/?state=s&error=access_denied`)
    expect(await errorCode(loop.code)).toBe('denied')
  })

  it('times out and closes', async () => {
    const loop = await startLoopback({ state: 's', timeoutMs: 80 })
    expect(await errorCode(loop.code)).toBe('timeout')
    await new Promise((r) => setTimeout(r, 20))
    expect(await get(`${loop.redirectUri}/?state=s&code=c`)).toEqual({ error: 'ECONNREFUSED' })
  })

  it('is cancelled by its abort signal', async () => {
    const ac = new AbortController()
    const loop = await startLoopback({ state: 's', timeoutMs: 5000, signal: ac.signal })
    ac.abort()
    expect(await errorCode(loop.code)).toBe('cancelled')
  })

  it('serves a page without script', () => {
    expect(returnPage(true)).not.toMatch(/<script/i)
    expect(returnPage(false)).toContain('もう一度お試しください')
  })
})

describe('authorize against the fake Google', () => {
  let google: FakeGoogle
  let config: GoogleConfig
  const fetchImpl: FetchLike = (u, i) => fetch(u, i)
  beforeEach(async () => {
    google = await new FakeGoogle().start()
    config = {
      clientId: google.clientId,
      clientSecret: google.clientSecret,
      endpoints: google.endpoints,
      authTimeoutMs: 5000,
    }
  })
  afterEach(() => google.close())

  it('exchanges the code with the matching verifier', async () => {
    const token = await authorize(
      { config, fetch: fetchImpl, openBrowser: fetchingOpener(fetchImpl) },
      { scopes: ['openid', 'email', 'profile'], offline: false },
    )
    expect(google.problems).toEqual([])
    expect(google.codeExchanges).toEqual([{ verifierOk: true }])
    expect(emailFromIdToken(token.id_token)).toBe('taro@example.com')
    expect(token.refresh_token).toBeUndefined()
  })

  it('never redeems a code whose redirect carried the wrong state', async () => {
    google.tamperState = true
    const code = await errorCode(
      authorize(
        { config, fetch: fetchImpl, openBrowser: fetchingOpener(fetchImpl) },
        { scopes: ['openid'], offline: false },
      ),
    )
    expect(code).toBe('state-mismatch')
    expect(google.requests.some((r) => r.path === '/token')).toBe(false)
  })

  it('reports a browser that cannot be opened and closes the listener', async () => {
    const code = await errorCode(
      authorize(
        {
          config,
          fetch: fetchImpl,
          openBrowser: async () => Promise.reject(new Error('no browser')),
        },
        { scopes: ['openid'], offline: false },
      ),
    )
    expect(code).toBe('failed')
  })
})

describe('multipart body', () => {
  it('has a JSON metadata part then the media part, framed by the boundary', () => {
    const m = multipartBody(
      { name: '報告', mimeType: 'application/vnd.google-apps.document' },
      '# 見出し\n本文',
      'text/markdown',
      'BND',
    )
    expect(m.contentType).toBe('multipart/related; boundary=BND')
    expect(m.body).toBe(
      [
        '--BND',
        'Content-Type: application/json; charset=UTF-8',
        '',
        '{"name":"報告","mimeType":"application/vnd.google-apps.document"}',
        '--BND',
        'Content-Type: text/markdown; charset=UTF-8',
        '',
        '# 見出し\n本文',
        '--BND--',
        '',
      ].join('\r\n'),
    )
    const parsed = parseMultipart(m.contentType, m.body)
    expect(parsed).not.toBeTypeOf('string')
  })

  it('picks another boundary when the content contains it', () => {
    const m = multipartBody({}, 'line --BND line', 'text/markdown', 'BND')
    expect(m.contentType).not.toContain('boundary=BND')
    const parsed = parseMultipart(m.contentType, m.body)
    expect(Array.isArray(parsed) && parsed[1].body).toBe('line --BND line')
  })

  it('asks for the id and link of the new file', () => {
    const u = new URL(uploadUrl(GOOGLE_ENDPOINTS.upload))
    expect(u.searchParams.get('uploadType')).toBe('multipart')
    expect(u.searchParams.get('fields')).toBe('id,webViewLink')
  })
})

describe('Markdown to HTML fallback', () => {
  it('renders tables and Japanese, and escapes raw HTML', () => {
    const html = markdownToHtml(`${JA_MARKDOWN}\n<script>alert(1)</script>\n`, '<報告>')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>東京</td>')
    expect(html).toContain('<strong>前年比 12%</strong>')
    expect(html).toContain('<title>&lt;報告&gt;</title>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('upload error mapping', () => {
  const http = (status: number, reasons: string[] = [], message = 'm') =>
    ({ ok: false, kind: 'http', status, reasons, message }) as const
  it.each([
    [http(401), 'text/markdown', { kind: 'reauth' }],
    [http(400, ['badContent']), 'text/markdown', { kind: 'conversion' }],
    [http(415), 'text/markdown', { kind: 'conversion' }],
  ] as const)('%o (%s) -> %o', (f, media, expected) => {
    expect(classifyUpload(f, media)).toEqual(expected)
  })

  it.each([
    [http(403, ['insufficientPermissions']), 'denied', /403 insufficientPermissions: m/],
    [http(403, ['appNotAuthorizedToFile']), 'denied', /appNotAuthorizedToFile/],
    [http(403, ['userRateLimitExceeded']), 'failed', /limiting requests/],
    [http(429), 'failed', /limiting requests/],
    [http(403, ['storageQuotaExceeded']), 'failed', /storage is full/],
    [http(403, ['accessNotConfigured']), 'failed', /API is not enabled/],
    [http(500, [], 'backend'), 'failed', /answered 500: backend/],
    [http(400, ['badRequest']), 'failed', /answered 400/],
    [
      { ok: false, kind: 'network', message: 'ECONNREFUSED' } as const,
      'failed',
      /could not reach Google Drive: ECONNREFUSED/,
    ],
  ] as const)('%o -> %s', (f, error, detail) => {
    // An HTML upload is already the fallback, so a 400 there is final.
    const r = classifyUpload(
      f,
      f.kind === 'http' && f.status === 400 ? 'text/html' : 'text/markdown',
    )
    expect(r.kind).toBe('final')
    if (r.kind !== 'final') return
    expect(r.result.error).toBe(error)
    expect(r.result.detail).toMatch(detail)
  })
})

describe('GoogleService', () => {
  let google: FakeGoogle
  let db: DatabaseSync
  let kv: KvStore
  let store: TokenStore
  let changes: GoogleConnection[]
  let clock: number
  const realFetch: FetchLike = (u, i) => fetch(u, i)

  function service(over: Partial<ConstructorParameters<typeof GoogleService>[0]> = {}) {
    return new GoogleService({
      config: {
        clientId: google.clientId,
        clientSecret: google.clientSecret,
        endpoints: google.endpoints,
        authTimeoutMs: 5000,
      },
      store,
      fetch: realFetch,
      openBrowser: fetchingOpener(realFetch),
      onChange: (c) => changes.push(c),
      now: () => clock,
      ...over,
    })
  }

  beforeEach(async () => {
    google = await new FakeGoogle().start()
    db = openDatabase(':memory:')
    kv = new KvStore(db)
    store = new TokenStore(kv, fakeCipher, 'google.account')
    changes = []
    clock = Date.now()
  })
  afterEach(async () => {
    db.close()
    await google.close()
  })

  it('does nothing at all when no client is configured', async () => {
    const fetchSpy = vi.fn(realFetch)
    const opener = vi.fn(async () => {})
    const storeSpy = { get: vi.fn(async () => null), set: vi.fn(async () => {}) }
    const s = service({ config: null, fetch: fetchSpy, openBrowser: opener, store: storeSpy })
    expect(await s.status()).toEqual(NOT_CONFIGURED)
    expect(await s.connect()).toEqual({ connection: NOT_CONFIGURED, error: 'not-configured' })
    expect(await s.disconnect()).toEqual(NOT_CONFIGURED)
    expect(await s.signIn()).toEqual({ ok: false, error: 'not-configured' })
    expect(await s.exportDoc({ title: 't', markdown: 'm' })).toEqual({
      ok: false,
      error: 'not-configured',
      detail: null,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(opener).not.toHaveBeenCalled()
    expect(storeSpy.get).not.toHaveBeenCalled()
    expect(storeSpy.set).not.toHaveBeenCalled()
    expect(changes).toEqual([])
  })

  it('signs in with identity scopes, returns the ID token and stores nothing', async () => {
    let consentUrl = ''
    const s = service({
      openBrowser: async (url) => {
        consentUrl = url
        await fetchingOpener(realFetch)(url)
      },
    })
    const result = await s.signIn()
    expect(result.ok).toBe(true)
    expect(emailFromIdToken(result.ok ? result.idToken : undefined)).toBe('taro@example.com')
    expect(new URL(consentUrl).searchParams.get('scope')).toBe('openid email profile')
    expect(kv.get('google.account')).toBeNull()
    expect(google.liveRefreshTokens).toEqual([])
    expect(changes).toEqual([])
    expect(await s.status()).toEqual({ configured: true, connected: false, email: null })
  })

  it('says denied when the member refuses sign-in', async () => {
    google.denyConsent = true
    expect(await service().signIn()).toEqual({ ok: false, error: 'denied' })
  })

  it('connects with drive.file offline, seals the refresh token, reports the email and broadcasts', async () => {
    let consentUrl = ''
    const s = service({
      openBrowser: async (url) => {
        consentUrl = url
        await fetchingOpener(realFetch)(url)
      },
    })
    const conn = await s.connect()
    const expected = { configured: true, connected: true, email: 'taro@example.com' }
    expect(conn).toEqual({ connection: expected, error: null })
    expect(changes).toEqual([expected])
    const q = new URL(consentUrl).searchParams
    expect(q.get('scope')).toBe(`openid email ${DRIVE_FILE_SCOPE}`)
    expect(q.get('access_type')).toBe('offline')
    const [refresh] = google.liveRefreshTokens
    const sealed = kv.get('google.account') ?? ''
    expect(sealed).not.toContain(refresh)
    expect(sealed).not.toBe('')
    expect(JSON.parse((await store.get()) ?? '{}')).toEqual({
      refreshToken: refresh,
      email: 'taro@example.com',
    })
    // A new service (next app start) still sees the connection.
    expect(await service().status()).toEqual(expected)
  })

  it('stays disconnected and revokes the grant when Drive is not granted', async () => {
    google.grant = (r) => r.filter((s) => s !== DRIVE_FILE_SCOPE)
    const conn = await service().connect()
    expect(conn).toEqual({
      connection: { configured: true, connected: false, email: null },
      error: 'denied',
    })
    expect(kv.get('google.account')).toBeNull()
    expect(google.revoked.length).toBe(1)
    expect(google.liveRefreshTokens).toEqual([])
    expect(changes).toEqual([])
  })

  it('cancels an unfinished consent flow when connect is called again', async () => {
    let firstRedirect = ''
    const s = service({
      openBrowser: async (url) => {
        // The first browser tab is abandoned by the member; the second completes.
        if (!firstRedirect) {
          firstRedirect = new URL(url).searchParams.get('redirect_uri') ?? ''
          return
        }
        await fetchingOpener(realFetch)(url)
      },
    })
    const abandoned = s.connect()
    await new Promise((r) => setTimeout(r, 50))
    const second = await s.connect()
    expect(second.connection.connected).toBe(true)
    // The abandoned flow settled instead of waiting for its timeout, and its listener is gone.
    expect((await abandoned).error).toBe('cancelled')
    expect(await get(`${firstRedirect}/?state=x&code=y`)).toEqual({ error: 'ECONNREFUSED' })
    expect(changes.length).toBe(1)
  })

  it('cancel() ends a consent flow the member abandoned, and says cancelled', async () => {
    let redirect = ''
    const s = service({
      openBrowser: async (url) => {
        redirect = new URL(url).searchParams.get('redirect_uri') ?? ''
      },
    })
    const pending = s.connect()
    await new Promise((r) => setTimeout(r, 50))
    s.cancel()
    expect(await pending).toEqual({
      connection: { configured: true, connected: false, email: null },
      error: 'cancelled',
    })
    expect(await get(`${redirect}/?state=x&code=y`)).toEqual({ error: 'ECONNREFUSED' })
    // Sign-in is a consent flow too.
    const signing = s.signIn()
    await new Promise((r) => setTimeout(r, 50))
    s.cancel()
    expect(await signing).toEqual({ ok: false, error: 'cancelled' })
    // Nothing waiting: a no-op.
    s.cancel()
    expect(changes).toEqual([])
  })

  it('a flow nobody completes ends with timeout; a broken redirect ends with failed', async () => {
    const quiet = service({
      config: {
        clientId: google.clientId,
        clientSecret: google.clientSecret,
        endpoints: google.endpoints,
        authTimeoutMs: 60,
      },
      openBrowser: async () => {},
    })
    expect(await quiet.signIn()).toEqual({ ok: false, error: 'timeout' })
    expect((await quiet.connect()).error).toBe('timeout')
    const broken = service({
      openBrowser: async () => {
        throw new Error('no browser')
      },
    })
    expect(await broken.signIn()).toEqual({ ok: false, error: 'failed' })
  })

  it('maps every OAuth failure onto a reason the UI can show', () => {
    expect(flowErrorOf(new GoogleAuthError('denied', 'x'))).toBe('denied')
    expect(flowErrorOf(new GoogleAuthError('timeout', 'x'))).toBe('timeout')
    expect(flowErrorOf(new GoogleAuthError('cancelled', 'x'))).toBe('cancelled')
    expect(flowErrorOf(new GoogleAuthError('state-mismatch', 'x'))).toBe('failed')
    expect(flowErrorOf(new GoogleAuthError('invalid-grant', 'x'))).toBe('failed')
    expect(flowErrorOf(new Error('boom'))).toBe('failed')
  })

  it('disconnect revokes at Google, deletes the token and broadcasts', async () => {
    const s = service()
    await s.connect()
    const [refresh] = google.liveRefreshTokens
    changes = []
    const conn = await s.disconnect()
    expect(conn).toEqual({ configured: true, connected: false, email: null })
    expect(google.revoked).toContain(refresh)
    expect(google.hasRefreshToken(refresh as string)).toBe(false)
    expect(kv.get('google.account')).toBeNull()
    expect(changes).toEqual([conn])
    // Nothing to change the second time: no broadcast.
    await s.disconnect()
    expect(changes.length).toBe(1)
  })

  it('reports not-connected before connect', async () => {
    expect(await service().exportDoc({ title: 't', markdown: 'm' })).toEqual({
      ok: false,
      error: 'not-connected',
      detail: null,
    })
  })

  it('exports Markdown as a Google Doc', async () => {
    const s = service()
    await s.connect()
    const r = await s.exportDoc({ title: '四半期レポート', markdown: JA_MARKDOWN })
    expect(google.problems).toEqual([])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.url).toBe(`https://docs.google.com/document/d/${r.docId}/edit?usp=drivesdk`)
    expect(google.uploads).toHaveLength(1)
    expect(google.uploads[0]).toMatchObject({
      name: '四半期レポート',
      metadataMime: 'application/vnd.google-apps.document',
      mediaType: 'text/markdown',
      content: JA_MARKDOWN,
    })
    // The access token from the consent exchange is reused; no refresh was needed.
    expect(google.refreshCount).toBe(0)
  })

  it('refreshes an access token that has expired by the clock', async () => {
    const s = service()
    await s.connect()
    await s.exportDoc({ title: 'a', markdown: 'a' })
    clock += 3600_000
    const r = await s.exportDoc({ title: 'b', markdown: 'b' })
    expect(r.ok).toBe(true)
    expect(google.refreshCount).toBe(1)
    expect(google.uploads[1]?.bearer).not.toBe(google.uploads[0]?.bearer)
  })

  it('refreshes once and retries when Drive answers 401', async () => {
    const s = service()
    await s.connect()
    google.expireAccessTokens()
    const r = await s.exportDoc({ title: 'a', markdown: 'a' })
    expect(r.ok).toBe(true)
    expect(google.refreshCount).toBe(1)
  })

  it('gives up with denied after one refresh if Drive keeps answering 401', async () => {
    const s = service()
    await s.connect()
    google.uploadFailure = { status: 401, body: { error: { code: 401, message: 'nope' } } }
    const r = await s.exportDoc({ title: 'a', markdown: 'a' })
    expect(r).toMatchObject({ ok: false, error: 'denied' })
    expect(google.refreshCount).toBe(1)
  })

  it('forgets a refresh token Google has revoked and reports not-connected', async () => {
    const s = service()
    await s.connect()
    google.revokeAllGrants()
    changes = []
    const r = await s.exportDoc({ title: 'a', markdown: 'a' })
    expect(r).toMatchObject({ ok: false, error: 'not-connected' })
    expect((r as { detail: string }).detail).toMatch(/connect Google again/)
    expect(kv.get('google.account')).toBeNull()
    expect(changes).toEqual([{ configured: true, connected: false, email: null }])
  })

  it('falls back to HTML when Google will not convert the Markdown', async () => {
    const s = service()
    await s.connect()
    google.rejectMarkdown = true
    const r = await s.exportDoc({ title: '四半期レポート', markdown: JA_MARKDOWN })
    expect(r.ok).toBe(true)
    expect(google.uploads).toHaveLength(1)
    const up = google.uploads[0]
    expect(up?.mediaType).toBe('text/html')
    expect(up?.content).toContain('<td>東京</td>')
    expect(up?.content).toContain('<h1>四半期レポート</h1>')
  })

  it('maps a Drive refusal and an unreachable Drive onto the contract errors', async () => {
    const s = service()
    await s.connect()
    google.uploadFailure = {
      status: 403,
      body: {
        error: {
          code: 403,
          message: 'Insufficient Permission',
          errors: [{ reason: 'insufficientPermissions' }],
        },
      },
    }
    expect(await s.exportDoc({ title: 'a', markdown: 'a' })).toEqual({
      ok: false,
      error: 'denied',
      detail: 'Google Drive answered 403 insufficientPermissions: Insufficient Permission',
    })
    const offline = service({
      config: {
        clientId: google.clientId,
        clientSecret: google.clientSecret,
        endpoints: { ...google.endpoints, upload: 'http://127.0.0.1:9/upload' },
        authTimeoutMs: 5000,
      },
    })
    const r = await offline.exportDoc({ title: 'a', markdown: 'a' })
    expect(r).toMatchObject({ ok: false, error: 'failed' })
    expect((r as { detail: string }).detail).toMatch(/^could not reach Google Drive/)
  })

  it('never logs tokens, codes or verifiers', async () => {
    const lines: string[] = []
    const s = service({ log: (m) => lines.push(m) })
    google.tamperState = true
    await s.connect()
    google.tamperState = false
    await s.connect()
    google.uploadFailure = { status: 500, body: { error: { code: 500, message: 'backend' } } }
    await s.exportDoc({ title: 'a', markdown: 'a' })
    expect(lines.length).toBeGreaterThan(0)
    const secrets = google.liveRefreshTokens
    for (const line of lines) {
      for (const secret of secrets) expect(line).not.toContain(secret)
      expect(line).not.toMatch(/ya29\.|4\/[0-9a-f]{8}|1\/\/[0-9a-f]{8}/)
    }
  })
})
