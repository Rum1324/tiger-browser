import { z } from 'zod'
import type { FetchLike, GoogleConfig } from './config'
import { GoogleAuthError } from './errors'
import { startLoopback } from './loopback'
import { createPkce, randomState } from './pkce'

export const SIGN_IN_SCOPES = ['openid', 'email', 'profile'] as const
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
/** Installed apps get no incremental authorization, so connect asks for identity and Drive at once. */
export const CONNECT_SCOPES = ['openid', 'email', DRIVE_FILE_SCOPE] as const

const TOKEN_TIMEOUT_MS = 30_000

export const TokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
})
export type TokenResponse = z.infer<typeof TokenResponse>

const TokenError = z.object({ error: z.string(), error_description: z.string().optional() })

export interface OAuthDeps {
  config: GoogleConfig
  fetch: FetchLike
  openBrowser(url: string): Promise<void>
}

export interface AuthorizeOptions {
  scopes: readonly string[]
  /** Ask for a refresh token (access_type=offline, prompt=consent so Google issues a new one). */
  offline: boolean
  signal?: AbortSignal
}

export function authorizationUrl(
  config: GoogleConfig,
  p: {
    redirectUri: string
    state: string
    challenge: string
    scopes: readonly string[]
    offline: boolean
  },
): string {
  const url = new URL(config.endpoints.authorize)
  const q = url.searchParams
  q.set('client_id', config.clientId)
  q.set('redirect_uri', p.redirectUri)
  q.set('response_type', 'code')
  q.set('scope', p.scopes.join(' '))
  q.set('code_challenge', p.challenge)
  q.set('code_challenge_method', 'S256')
  q.set('state', p.state)
  if (p.offline) {
    q.set('access_type', 'offline')
    q.set('prompt', 'consent')
  } else {
    q.set('prompt', 'select_account')
  }
  return url.toString()
}

async function postForm(
  deps: OAuthDeps,
  url: string,
  form: Record<string, string>,
): Promise<{ status: number; json: unknown }> {
  let res: Response
  try {
    res = await deps.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    })
  } catch (err) {
    throw new GoogleAuthError('failed', `could not reach Google: ${(err as Error).message}`)
  }
  const text = await res.text().catch(() => '')
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status, json }
}

function clientFields(config: GoogleConfig): Record<string, string> {
  return config.clientSecret
    ? { client_id: config.clientId, client_secret: config.clientSecret }
    : { client_id: config.clientId }
}

async function tokenRequest(deps: OAuthDeps, form: Record<string, string>): Promise<TokenResponse> {
  const { status, json } = await postForm(deps, deps.config.endpoints.token, {
    ...clientFields(deps.config),
    ...form,
  })
  if (status >= 200 && status < 300) {
    const parsed = TokenResponse.safeParse(json)
    if (parsed.success) return parsed.data
    throw new GoogleAuthError('failed', 'Google returned a malformed token response')
  }
  const err = TokenError.safeParse(json)
  const code = err.success ? err.data.error : `HTTP ${status}`
  // Google's error_description is a fixed sentence about the request, never a credential.
  const why = err.success && err.data.error_description ? `: ${err.data.error_description}` : ''
  if (code === 'invalid_grant') {
    throw new GoogleAuthError('invalid-grant', `Google refused the grant${why}`)
  }
  throw new GoogleAuthError('failed', `the token request failed with ${code}${why}`)
}

/**
 * The installed-app flow: the consent page opens in the system browser (Google blocks embedded
 * user agents), the redirect comes back to a one-shot 127.0.0.1 listener, PKCE S256 binds the code
 * to this process, and the state value is checked before the code is used.
 */
export async function authorize(deps: OAuthDeps, opts: AuthorizeOptions): Promise<TokenResponse> {
  const pkce = createPkce()
  const state = randomState()
  const loop = await startLoopback({
    state,
    timeoutMs: deps.config.authTimeoutMs,
    signal: opts.signal,
  })
  const url = authorizationUrl(deps.config, {
    redirectUri: loop.redirectUri,
    state,
    challenge: pkce.challenge,
    scopes: opts.scopes,
    offline: opts.offline,
  })
  try {
    await deps.openBrowser(url)
  } catch (err) {
    loop.close()
    throw new GoogleAuthError('failed', `could not open the browser: ${(err as Error).message}`)
  }
  const code = await loop.code
  return tokenRequest(deps, {
    grant_type: 'authorization_code',
    code,
    code_verifier: pkce.verifier,
    redirect_uri: loop.redirectUri,
  })
}

export function refreshAccessToken(deps: OAuthDeps, refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(deps, { grant_type: 'refresh_token', refresh_token: refreshToken })
}

/** Revoking the refresh token also ends every access token issued from it. */
export async function revokeToken(deps: OAuthDeps, token: string): Promise<boolean> {
  try {
    const { status } = await postForm(deps, deps.config.endpoints.revoke, { token })
    // 400 invalid_token: already revoked or expired, which is the outcome we wanted.
    return (status >= 200 && status < 300) || status === 400
  } catch {
    return false
  }
}

export function grantedScopes(token: TokenResponse): Set<string> {
  return new Set((token.scope ?? '').split(/\s+/).filter(Boolean))
}

/**
 * The email claim of an ID token, for display only. The token came straight from Google's token
 * endpoint over TLS, which OpenID Connect accepts in place of a signature check; the server still
 * verifies the signature of any ID token it is given.
 */
export function emailFromIdToken(idToken: string | undefined): string | null {
  const payload = idToken?.split('.')[1]
  if (!payload) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown
    if (claims && typeof claims === 'object' && 'email' in claims) {
      const email = (claims as { email: unknown }).email
      return typeof email === 'string' ? email : null
    }
  } catch {
    return null
  }
  return null
}
