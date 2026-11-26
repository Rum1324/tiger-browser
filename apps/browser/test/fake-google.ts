import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * A local stand-in for Google's OAuth and Drive upload endpoints, strict where the real ones are:
 * it checks the client, the loopback redirect, the PKCE verifier, single-use codes, the bearer
 * token and its scope, and the multipart/related body. Used by unit and E2E tests.
 */

export const DOC_MIME = 'application/vnd.google-apps.document'

export interface FakeUpload {
  name: string
  metadataMime: string
  mediaType: string
  content: string
  bearer: string
}

export interface FakeGoogleOptions {
  clientId?: string
  /** When set, the token endpoint requires it. */
  clientSecret?: string | null
  email?: string
  accessTokenLifetimeS?: number
}

interface CodeGrant {
  clientId: string
  redirectUri: string
  challenge: string
  scopes: string[]
  offline: boolean
}

export class FakeGoogle {
  readonly clientId: string
  readonly clientSecret: string | null
  email: string
  accessTokenLifetimeS: number
  base = ''

  // Knobs a test may flip.
  /** Scopes granted out of those requested (the consent screen lets members untick Drive). */
  grant: (requested: string[]) => string[] = (r) => r
  denyConsent = false
  /** The authorization endpoint answers with a different state, as a forged redirect would. */
  tamperState = false
  rejectMarkdown = false
  /** Every upload answers this, whatever the request. */
  uploadFailure: { status: number; body: unknown } | null = null

  // Records.
  readonly requests: { method: string; path: string }[] = []
  readonly problems: string[] = []
  readonly uploads: FakeUpload[] = []
  readonly revoked: string[] = []
  readonly codeExchanges: { verifierOk: boolean }[] = []
  refreshCount = 0

  private readonly codes = new Map<string, CodeGrant>()
  private readonly refreshTokens = new Map<string, string[]>()
  private readonly accessTokens = new Map<
    string,
    { expiresAt: number; scopes: string[]; refresh: string | null }
  >()
  private server = createServer((req, res) => {
    this.handle(req, res).catch((err) => {
      this.problems.push(`handler threw: ${String(err)}`)
      res.writeHead(500).end()
    })
  })

  constructor(opts: FakeGoogleOptions = {}) {
    this.clientId = opts.clientId ?? 'test-client.apps.googleusercontent.com'
    this.clientSecret = opts.clientSecret === undefined ? 'test-secret' : opts.clientSecret
    this.email = opts.email ?? 'taro@example.com'
    this.accessTokenLifetimeS = opts.accessTokenLifetimeS ?? 3600
  }

  async start(): Promise<this> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r))
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
    return this
  }

  async close(): Promise<void> {
    this.server.closeAllConnections()
    await new Promise<void>((r) => this.server.close(() => r()))
  }

  get endpoints() {
    return {
      authorize: `${this.base}/o/oauth2/v2/auth`,
      token: `${this.base}/token`,
      revoke: `${this.base}/revoke`,
      upload: `${this.base}/upload/drive/v3/files`,
    }
  }

  /** Environment for a Tiger process pointed at this fake. */
  env(): Record<string, string> {
    const e = this.endpoints
    return {
      TIGER_GOOGLE_CLIENT_ID: this.clientId,
      ...(this.clientSecret ? { TIGER_GOOGLE_CLIENT_SECRET: this.clientSecret } : {}),
      TIGER_GOOGLE_AUTH_ENDPOINT: e.authorize,
      TIGER_GOOGLE_TOKEN_ENDPOINT: e.token,
      TIGER_GOOGLE_REVOKE_ENDPOINT: e.revoke,
      TIGER_GOOGLE_UPLOAD_ENDPOINT: e.upload,
      TIGER_GOOGLE_TEST_OPENER: 'fetch',
    }
  }

  /** Invalidate every access token now, as if Google had expired them early. */
  expireAccessTokens(): void {
    this.accessTokens.clear()
  }

  /** Revoke every grant behind the client's back (the member removed access in their account). */
  revokeAllGrants(): void {
    this.refreshTokens.clear()
    this.accessTokens.clear()
  }

  hasRefreshToken(token: string): boolean {
    return this.refreshTokens.has(token)
  }

  get liveRefreshTokens(): string[] {
    return [...this.refreshTokens.keys()]
  }

  private issueAccess(scopes: string[], refresh: string | null): string {
    const token = `ya29.${randomBytes(12).toString('hex')}`
    this.accessTokens.set(token, {
      expiresAt: Date.now() + this.accessTokenLifetimeS * 1000,
      scopes,
      refresh,
    })
    return token
  }

  private idToken(): string {
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    return `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
      iss: 'https://accounts.google.com',
      aud: this.clientId,
      sub: '1234567890',
      email: this.email,
      email_verified: true,
    })}.fake-signature`
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.base)
    this.requests.push({ method: req.method ?? '', path: url.pathname })
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body))
    }
    const bad = (problem: string) => {
      this.problems.push(problem)
      json(400, { error: 'invalid_request', error_description: problem })
    }

    if (req.method === 'GET' && url.pathname === '/o/oauth2/v2/auth') {
      const q = url.searchParams
      const redirectUri = q.get('redirect_uri') ?? ''
      if (q.get('client_id') !== this.clientId) return bad('authorize: wrong client_id')
      if (!/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(redirectUri))
        return bad('authorize: redirect_uri is not a loopback IP')
      if (q.get('response_type') !== 'code') return bad('authorize: response_type')
      if (q.get('code_challenge_method') !== 'S256')
        return bad('authorize: PKCE method is not S256')
      const challenge = q.get('code_challenge') ?? ''
      if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) return bad('authorize: malformed code_challenge')
      const state = q.get('state')
      if (!state) return bad('authorize: no state')
      const scopes = (q.get('scope') ?? '').split(' ').filter(Boolean)
      if (scopes.length === 0) return bad('authorize: no scope')
      const target = new URL(redirectUri)
      target.searchParams.set('state', this.tamperState ? `${state}x` : state)
      if (this.denyConsent) {
        target.searchParams.set('error', 'access_denied')
      } else {
        const code = `4/${randomBytes(16).toString('hex')}`
        this.codes.set(code, {
          clientId: this.clientId,
          redirectUri,
          challenge,
          scopes: this.grant(scopes),
          offline: q.get('access_type') === 'offline',
        })
        target.searchParams.set('code', code)
      }
      res.writeHead(302, { Location: target.toString() })
      res.end()
      return
    }

    if (req.method === 'POST' && url.pathname === '/token') {
      if (!(req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) {
        return bad('token: not a form post')
      }
      const f = new URLSearchParams(raw)
      if (f.get('client_id') !== this.clientId) return bad('token: wrong client_id')
      if (this.clientSecret && f.get('client_secret') !== this.clientSecret) {
        return json(401, { error: 'invalid_client', error_description: 'Unauthorized' })
      }
      if (f.get('grant_type') === 'authorization_code') {
        const code = f.get('code') ?? ''
        const grant = this.codes.get(code)
        this.codes.delete(code)
        if (!grant)
          return json(400, { error: 'invalid_grant', error_description: 'Malformed auth code.' })
        if (f.get('redirect_uri') !== grant.redirectUri)
          return bad('token: redirect_uri differs from the authorization request')
        const verifier = f.get('code_verifier') ?? ''
        const verifierOk =
          createHash('sha256').update(verifier, 'ascii').digest('base64url') === grant.challenge
        this.codeExchanges.push({ verifierOk })
        if (!verifierOk)
          return json(400, { error: 'invalid_grant', error_description: 'Invalid code verifier.' })
        const refresh = grant.offline ? `1//${randomBytes(16).toString('hex')}` : null
        if (refresh) this.refreshTokens.set(refresh, grant.scopes)
        return json(200, {
          access_token: this.issueAccess(grant.scopes, refresh),
          expires_in: this.accessTokenLifetimeS,
          ...(refresh ? { refresh_token: refresh } : {}),
          ...(grant.scopes.includes('openid') ? { id_token: this.idToken() } : {}),
          scope: grant.scopes.join(' '),
          token_type: 'Bearer',
        })
      }
      if (f.get('grant_type') === 'refresh_token') {
        const refresh = f.get('refresh_token') ?? ''
        const scopes = this.refreshTokens.get(refresh)
        if (!scopes) {
          return json(400, {
            error: 'invalid_grant',
            error_description: 'Token has been expired or revoked.',
          })
        }
        this.refreshCount++
        return json(200, {
          access_token: this.issueAccess(scopes, refresh),
          expires_in: this.accessTokenLifetimeS,
          scope: scopes.join(' '),
          token_type: 'Bearer',
        })
      }
      return bad('token: unsupported grant_type')
    }

    if (req.method === 'POST' && url.pathname === '/revoke') {
      const token = new URLSearchParams(raw).get('token') ?? ''
      this.revoked.push(token)
      if (this.refreshTokens.delete(token)) {
        for (const [a, info] of this.accessTokens)
          if (info.refresh === token) this.accessTokens.delete(a)
        return json(200, {})
      }
      if (this.accessTokens.delete(token)) return json(200, {})
      return json(400, { error: 'invalid_token' })
    }

    if (req.method === 'POST' && url.pathname === '/upload/drive/v3/files') {
      if (this.uploadFailure) return json(this.uploadFailure.status, this.uploadFailure.body)
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? ''
      const access = this.accessTokens.get(bearer)
      if (!access || access.expiresAt < Date.now()) {
        return json(401, {
          error: {
            code: 401,
            message: 'Request had invalid authentication credentials.',
            status: 'UNAUTHENTICATED',
          },
        })
      }
      if (!access.scopes.includes('https://www.googleapis.com/auth/drive.file')) {
        return json(403, {
          error: {
            code: 403,
            message: 'Request had insufficient authentication scopes.',
            errors: [{ reason: 'insufficientPermissions' }],
          },
        })
      }
      if (url.searchParams.get('uploadType') !== 'multipart')
        return bad('upload: uploadType is not multipart')
      const parsed = parseMultipart(req.headers['content-type'] ?? '', raw)
      if (typeof parsed === 'string') return bad(`upload: ${parsed}`)
      const [meta, media] = parsed
      if (!/^application\/json/.test(meta.type)) return bad('upload: first part is not JSON')
      let metadata: { name?: unknown; mimeType?: unknown }
      try {
        metadata = JSON.parse(meta.body)
      } catch {
        return bad('upload: metadata is not JSON')
      }
      if (typeof metadata.name !== 'string' || !metadata.name) return bad('upload: no name')
      if (metadata.mimeType !== DOC_MIME) return bad('upload: target type is not a Google Doc')
      const mediaType = media.type.split(';')[0]?.trim() ?? ''
      if (mediaType !== 'text/markdown' && mediaType !== 'text/html')
        return bad('upload: unexpected media type')
      if (this.rejectMarkdown && mediaType === 'text/markdown') {
        return json(400, {
          error: {
            code: 400,
            message: 'Unable to convert the uploaded content.',
            errors: [{ reason: 'badContent' }],
          },
        })
      }
      this.uploads.push({
        name: metadata.name,
        metadataMime: metadata.mimeType,
        mediaType,
        content: media.body,
        bearer,
      })
      const id = `doc${this.uploads.length}_${randomBytes(6).toString('hex')}`
      return json(200, {
        id,
        webViewLink: `https://docs.google.com/document/d/${id}/edit?usp=drivesdk`,
      })
    }

    res.writeHead(404).end()
  }
}

/** Parse a two-part multipart/related body; returns a problem string when it is malformed. */
export function parseMultipart(
  contentType: string,
  raw: string,
): [{ type: string; body: string }, { type: string; body: string }] | string {
  const boundary = /^multipart\/related;\s*boundary=("?)([^";]+)\1$/.exec(contentType)?.[2]
  if (!boundary) return 'not multipart/related with a boundary'
  const delim = `--${boundary}`
  if (!raw.startsWith(`${delim}\r\n`)) return 'body does not start with the boundary'
  const end = `\r\n${delim}--`
  const endAt = raw.lastIndexOf(end)
  if (endAt < 0) return 'no closing boundary'
  const inner = raw.slice(delim.length + 2, endAt)
  const parts = inner.split(`\r\n${delim}\r\n`)
  if (parts.length !== 2) return `expected 2 parts, got ${parts.length}`
  const out = parts.map((p) => {
    const sep = p.indexOf('\r\n\r\n')
    const head = sep < 0 ? p : p.slice(0, sep)
    const type = /^content-type:\s*(.+)$/im.exec(head)?.[1]?.trim() ?? ''
    return { type, body: sep < 0 ? '' : p.slice(sep + 4) }
  })
  return [out[0] as { type: string; body: string }, out[1] as { type: string; body: string }]
}
