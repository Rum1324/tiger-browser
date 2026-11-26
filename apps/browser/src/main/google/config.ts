/**
 * Google OAuth client configuration, read once at startup. No Electron import: unit tests load it.
 *
 * TIGER_GOOGLE_CLIENT_ID      the "Desktop app" OAuth client id. Absent: every Google feature reports
 *                             not-configured.
 * TIGER_GOOGLE_CLIENT_SECRET  that client's secret. Google documents desktop clients as public and the
 *                             secret as optional, but this is unverified, so it is sent when present.
 *
 * Development and test runs only (ignored by packaged builds, so nobody can point a member's tokens at
 * another host by setting a variable):
 * TIGER_GOOGLE_AUTH_ENDPOINT, TIGER_GOOGLE_TOKEN_ENDPOINT, TIGER_GOOGLE_REVOKE_ENDPOINT,
 * TIGER_GOOGLE_UPLOAD_ENDPOINT  replace the Google endpoints (a fake Google in E2E tests).
 * TIGER_GOOGLE_TEST_OPENER=fetch  the main process requests the consent URL itself instead of opening
 *                             the system browser (E2E tests have no browser to click through).
 * TIGER_GOOGLE_AUTH_TIMEOUT_MS how long to wait for the browser to come back.
 */

export interface GoogleEndpoints {
  authorize: string
  token: string
  revoke: string
  /** Drive files.create on the upload host, without query parameters. */
  upload: string
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  upload: 'https://www.googleapis.com/upload/drive/v3/files',
}

/** Five minutes: long enough to sign in and pass two-step verification, short enough not to linger. */
export const DEFAULT_AUTH_TIMEOUT_MS = 5 * 60_000

export interface GoogleConfig {
  clientId: string
  clientSecret: string | null
  endpoints: GoogleEndpoints
  authTimeoutMs: number
}

type Env = Record<string, string | undefined>

function httpUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

export function googleConfigFromEnv(
  env: Env,
  opts: { allowOverrides: boolean },
): GoogleConfig | null {
  const clientId = env.TIGER_GOOGLE_CLIENT_ID?.trim()
  if (!clientId) return null
  const o = opts.allowOverrides
  const pick = (name: string, fallback: string) => (o ? httpUrl(env[name]) : null) ?? fallback
  const timeout = o ? Number(env.TIGER_GOOGLE_AUTH_TIMEOUT_MS) : Number.NaN
  return {
    clientId,
    clientSecret: env.TIGER_GOOGLE_CLIENT_SECRET?.trim() || null,
    endpoints: {
      authorize: pick('TIGER_GOOGLE_AUTH_ENDPOINT', GOOGLE_ENDPOINTS.authorize),
      token: pick('TIGER_GOOGLE_TOKEN_ENDPOINT', GOOGLE_ENDPOINTS.token),
      revoke: pick('TIGER_GOOGLE_REVOKE_ENDPOINT', GOOGLE_ENDPOINTS.revoke),
      upload: pick('TIGER_GOOGLE_UPLOAD_ENDPOINT', GOOGLE_ENDPOINTS.upload),
    },
    authTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_AUTH_TIMEOUT_MS,
  }
}

/** Whether a development run asked for the fetching opener instead of the system browser. */
export function wantsFetchOpener(env: Env, opts: { allowOverrides: boolean }): boolean {
  return opts.allowOverrides && env.TIGER_GOOGLE_TEST_OPENER === 'fetch'
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * Stands in for the member in E2E runs: requests the consent URL and follows redirects, so a fake
 * Google that approves at once lands on the loopback listener like a browser would.
 */
export function fetchingOpener(fetchImpl: FetchLike): (url: string) => Promise<void> {
  return async (url) => {
    const res = await fetchImpl(url, { redirect: 'follow' })
    await res.arrayBuffer()
  }
}
