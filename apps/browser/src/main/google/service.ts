import type {
  EngineRequest,
  EngineResponse,
  GoogleConnection,
  GoogleFlowError,
  GoogleFlowResult,
} from '@tiger/shared'
import { z } from 'zod'
import type { FetchLike, GoogleConfig } from './config'
import { type MediaType, type UploadOutcome, uploadDocument } from './drive'
import { GoogleAuthError } from './errors'
import { markdownToHtml } from './markdown-html'
import {
  authorize,
  CONNECT_SCOPES,
  DRIVE_FILE_SCOPE,
  emailFromIdToken,
  grantedScopes,
  type OAuthDeps,
  refreshAccessToken,
  revokeToken,
  SIGN_IN_SCOPES,
} from './oauth'

export type ExportDocRequest = EngineRequest<'google.exportDoc'>
export type ExportDocResult = EngineResponse<'google.exportDoc'>
export type SignInResult = EngineResponse<'auth.googleSignIn'>

/** The reason the UI is told when a consent flow ends without a result. */
export function flowErrorOf(err: unknown): GoogleFlowError {
  if (!(err instanceof GoogleAuthError)) return 'failed'
  switch (err.code) {
    case 'denied':
    case 'timeout':
    case 'cancelled':
      return err.code
    default:
      // state-mismatch, invalid-grant, failed: nothing the member can act on beyond retrying.
      return 'failed'
  }
}

/** One sealed secret; the engine's TokenStore under its own key fits. */
export interface SecretStore {
  get(): Promise<string | null>
  set(value: string | null): Promise<void>
}

export interface GoogleServiceDeps {
  /** null: no OAuth client configured; every command answers not-configured and touches nothing. */
  config: GoogleConfig | null
  store: SecretStore
  fetch: FetchLike
  openBrowser(url: string): Promise<void>
  onChange(connection: GoogleConnection): void
  now?: () => number
  /** Where failures are reported. Only error codes and Google's error sentences reach it. */
  log?: (message: string) => void
}

const StoredAccount = z.object({ refreshToken: z.string().min(1), email: z.string().nullable() })
type StoredAccount = z.infer<typeof StoredAccount>

export const NOT_CONFIGURED: GoogleConnection = { connected: false, email: null, configured: false }

/** Refresh a minute early so a token does not expire between the check and the upload. */
const EXPIRY_MARGIN_MS = 60_000
const DEFAULT_LIFETIME_S = 3600

type UploadFailure = Exclude<UploadOutcome, { ok: true }>
type Classified =
  | { kind: 'reauth' }
  | { kind: 'conversion' }
  | { kind: 'final'; result: Extract<ExportDocResult, { ok: false }> }

const RATE_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'dailyLimitExceeded',
  'quotaExceeded',
  'RESOURCE_EXHAUSTED',
])

function describe(f: UploadFailure): string {
  if (f.kind === 'network') return `could not reach Google Drive: ${f.message}`
  const reason = f.reasons[0] ? ` ${f.reasons[0]}` : ''
  return `Google Drive answered ${f.status}${reason}${f.message ? `: ${f.message}` : ''}`
}

/** Map one failed upload onto what the service does next. */
export function classifyUpload(f: UploadFailure, mediaType: MediaType): Classified {
  const fail = (error: 'denied' | 'failed', detail: string): Classified => ({
    kind: 'final',
    result: { ok: false, error, detail },
  })
  if (f.kind === 'network') return fail('failed', describe(f))
  if (f.status === 401) return { kind: 'reauth' }
  if (f.status === 403 || f.status === 429) {
    if (f.reasons.includes('storageQuotaExceeded')) {
      return fail('failed', `Google Drive storage is full. ${describe(f)}`)
    }
    if (f.reasons.includes('accessNotConfigured') || f.reasons.includes('SERVICE_DISABLED')) {
      return fail(
        'failed',
        `The Google Drive API is not enabled for this OAuth client's Cloud project. ${describe(f)}`,
      )
    }
    if (f.status === 429 || f.reasons.some((r) => RATE_REASONS.has(r))) {
      return fail('failed', `Google Drive is limiting requests; try again shortly. ${describe(f)}`)
    }
    // insufficientPermissions, appNotAuthorizedToFile, forbidden and any reason not listed above.
    return fail('denied', describe(f))
  }
  // Drive reports an import it cannot convert as a client error on the request.
  if (mediaType === 'text/markdown' && (f.status === 400 || f.status === 415 || f.status === 422)) {
    return { kind: 'conversion' }
  }
  return fail('failed', describe(f))
}

/**
 * Google account features of the engine: sign-in for the product (ID token only, nothing kept),
 * the Drive connection (refresh token sealed by the OS keychain), and exporting Markdown to a new
 * Google Doc. Access tokens live only in memory.
 */
export class GoogleService {
  private access: { refreshToken: string; token: string; expiresAt: number } | null = null
  private refreshing: Promise<string> | null = null
  private flow: AbortController | null = null
  private readonly now: () => number

  constructor(private readonly deps: GoogleServiceDeps) {
    this.now = deps.now ?? Date.now
  }

  get configured(): boolean {
    return this.deps.config !== null
  }

  private oauth(config: GoogleConfig): OAuthDeps {
    return { config, fetch: this.deps.fetch, openBrowser: this.deps.openBrowser }
  }

  private log(message: string): void {
    this.deps.log?.(`tiger google: ${message}`)
  }

  private async load(): Promise<StoredAccount | null> {
    let raw: string | null
    try {
      raw = await this.deps.store.get()
    } catch {
      return null
    }
    if (!raw) return null
    try {
      const parsed = StoredAccount.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  private connection(account: StoredAccount | null): GoogleConnection {
    return { configured: true, connected: account !== null, email: account?.email ?? null }
  }

  async status(): Promise<GoogleConnection> {
    if (!this.deps.config) return NOT_CONFIGURED
    return this.connection(await this.load())
  }

  /** Only one consent flow at a time: starting another closes the earlier listener. */
  private beginFlow(): AbortController {
    this.flow?.abort()
    const controller = new AbortController()
    this.flow = controller
    return controller
  }

  private endFlow(controller: AbortController): void {
    if (this.flow === controller) this.flow = null
  }

  /** The member gave up on the consent page: close the listener; the waiting call ends `cancelled`. */
  cancel(): void {
    this.flow?.abort()
    this.flow = null
  }

  async signIn(): Promise<SignInResult> {
    const config = this.deps.config
    if (!config) return { ok: false, error: 'not-configured' }
    const controller = this.beginFlow()
    try {
      const token = await authorize(this.oauth(config), {
        scopes: SIGN_IN_SCOPES,
        offline: false,
        signal: controller.signal,
      })
      if (!token.id_token) {
        this.log('sign-in returned no ID token')
        return { ok: false, error: 'failed' }
      }
      return { ok: true, idToken: token.id_token }
    } catch (err) {
      this.log(`sign-in failed (${codeOf(err)}): ${(err as Error).message}`)
      return { ok: false, error: flowErrorOf(err) }
    } finally {
      this.endFlow(controller)
    }
  }

  async connect(): Promise<GoogleFlowResult> {
    const config = this.deps.config
    if (!config) return { connection: NOT_CONFIGURED, error: 'not-configured' }
    const controller = this.beginFlow()
    const oauth = this.oauth(config)
    try {
      const token = await authorize(oauth, {
        scopes: CONNECT_SCOPES,
        offline: true,
        signal: controller.signal,
      })
      // Google's consent screen lets the member untick Drive; without it the connection is useless.
      if (!grantedScopes(token).has(DRIVE_FILE_SCOPE)) {
        await revokeToken(oauth, token.refresh_token ?? token.access_token)
        throw new GoogleAuthError('denied', 'Drive access was not granted')
      }
      if (!token.refresh_token) {
        throw new GoogleAuthError('failed', 'Google returned no refresh token')
      }
      const previous = await this.load()
      const account: StoredAccount = {
        refreshToken: token.refresh_token,
        email: emailFromIdToken(token.id_token),
      }
      await this.deps.store.set(JSON.stringify(account))
      this.access = {
        refreshToken: account.refreshToken,
        token: token.access_token,
        expiresAt: this.now() + (token.expires_in ?? DEFAULT_LIFETIME_S) * 1000,
      }
      if (previous && previous.refreshToken !== account.refreshToken) {
        // Reconnecting (perhaps as another account) must not leave the old grant alive.
        await revokeToken(oauth, previous.refreshToken)
      }
      const conn = this.connection(account)
      this.deps.onChange(conn)
      return { connection: conn, error: null }
    } catch (err) {
      this.log(`connect failed (${codeOf(err)}): ${(err as Error).message}`)
      return { connection: this.connection(await this.load()), error: flowErrorOf(err) }
    } finally {
      this.endFlow(controller)
    }
  }

  async disconnect(): Promise<GoogleConnection> {
    const config = this.deps.config
    if (!config) return NOT_CONFIGURED
    const account = await this.load()
    this.access = null
    if (!account) return this.connection(null)
    const revoked = await revokeToken(this.oauth(config), account.refreshToken)
    if (!revoked) this.log('revocation did not succeed; the local token is deleted anyway')
    await this.deps.store.set(null)
    const conn = this.connection(null)
    this.deps.onChange(conn)
    return conn
  }

  /** Google no longer accepts the refresh token: forget it so the UI offers to connect again. */
  private async forget(): Promise<void> {
    this.access = null
    await this.deps.store.set(null)
    this.deps.onChange(this.connection(null))
  }

  private async accessToken(
    config: GoogleConfig,
    account: StoredAccount,
    force: boolean,
  ): Promise<string> {
    const cached = this.access
    if (
      !force &&
      cached &&
      cached.refreshToken === account.refreshToken &&
      this.now() < cached.expiresAt - EXPIRY_MARGIN_MS
    ) {
      return cached.token
    }
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const token = await refreshAccessToken(this.oauth(config), account.refreshToken)
          const refreshToken = token.refresh_token ?? account.refreshToken
          if (refreshToken !== account.refreshToken) {
            await this.deps.store.set(JSON.stringify({ ...account, refreshToken }))
          }
          this.access = {
            refreshToken,
            token: token.access_token,
            expiresAt: this.now() + (token.expires_in ?? DEFAULT_LIFETIME_S) * 1000,
          }
          return token.access_token
        } finally {
          this.refreshing = null
        }
      })()
    }
    return this.refreshing
  }

  async exportDoc(req: ExportDocRequest): Promise<ExportDocResult> {
    const config = this.deps.config
    if (!config) return { ok: false, error: 'not-configured', detail: null }
    const account = await this.load()
    if (!account) return { ok: false, error: 'not-connected', detail: null }

    let mediaType: MediaType = 'text/markdown'
    let content = req.markdown
    let refreshed = false
    let token: string
    try {
      token = await this.accessToken(config, account, false)
    } catch (err) {
      return this.tokenFailure(err)
    }

    for (;;) {
      const outcome = await uploadDocument(this.deps.fetch, config.endpoints.upload, token, {
        title: req.title,
        content,
        mediaType,
      })
      if (outcome.ok) return { ok: true, url: outcome.url, docId: outcome.id }
      const next = classifyUpload(outcome, mediaType)
      if (next.kind === 'final') {
        this.log(`export failed: ${next.result.detail}`)
        return next.result
      }
      if (next.kind === 'conversion') {
        this.log(`Markdown import refused (${describeShort(outcome)}); retrying as HTML`)
        mediaType = 'text/html'
        content = markdownToHtml(req.markdown, req.title)
        continue
      }
      // 401: the access token expired early or was revoked. One refresh, then give up.
      if (refreshed) {
        return {
          ok: false,
          error: 'denied',
          detail: 'Google Drive rejected a freshly refreshed access token (401)',
        }
      }
      refreshed = true
      try {
        token = await this.accessToken(config, account, true)
      } catch (err) {
        return this.tokenFailure(err)
      }
    }
  }

  private async tokenFailure(err: unknown): Promise<ExportDocResult> {
    if (err instanceof GoogleAuthError && err.code === 'invalid-grant') {
      await this.forget()
      return {
        ok: false,
        error: 'not-connected',
        detail: `Google access was revoked or has expired; connect Google again. ${err.message}`,
      }
    }
    return { ok: false, error: 'failed', detail: (err as Error).message }
  }
}

function codeOf(err: unknown): string {
  return err instanceof GoogleAuthError ? err.code : 'error'
}

function describeShort(f: UploadFailure): string {
  return f.kind === 'network' ? 'network' : `${f.status}`
}
