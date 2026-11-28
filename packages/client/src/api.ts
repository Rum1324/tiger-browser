import {
  API_ERROR_CODES,
  ApiError,
  type ApiErrorCode,
  type ApiRouteName,
  api,
  buildPath,
  type RouteDef,
  type RouteInput,
  type RouteOutput,
} from '@tiger/shared'

/**
 * Typed REST client over the contract's route table. One function, `call(api.route, input)`, covers
 * every route, so a contract change is a compile error here instead of a runtime surprise.
 */

/**
 * Codes the client can report on top of the server's: `network` (no HTTP response at all),
 * `aborted` (the caller cancelled), `send_failed` (a message got no response and the thread, read
 * again, does not have it), and `attachment_unconfirmed` (a page attachment was not confirmed for
 * the provider of the model that would read it). Everything else is an ApiErrorCode from the server.
 */
export type ClientErrorCode =
  | ApiErrorCode
  | 'network'
  | 'aborted'
  | 'send_failed'
  | 'attachment_unconfirmed'

/**
 * `server`: the server answered with an error body. `network`: no response (offline, DNS, refused).
 * `contract`: a response arrived but does not match the contract (code `contract_violation`).
 * `client`: refused locally before any request was made (e.g. attachments on a Space thread).
 */
export type ApiErrorKind = 'server' | 'network' | 'contract' | 'client' | 'aborted'

export class ApiClientError extends Error {
  override readonly name = 'ApiClientError'
  constructor(
    readonly kind: ApiErrorKind,
    readonly code: ClientErrorCode,
    message: string,
    /** HTTP status, or null when no response arrived. */
    readonly status: number | null = null,
    readonly route: string | null = null,
  ) {
    super(message)
  }
  get isNetwork(): boolean {
    return this.kind === 'network'
  }
}

export function isApiClientError(e: unknown): e is ApiClientError {
  return e instanceof ApiClientError
}

/** Wraps anything thrown into an ApiClientError so stores keep one error type. */
export function toClientError(e: unknown): ApiClientError {
  if (e instanceof ApiClientError) return e
  if (isAbortError(e)) return new ApiClientError('aborted', 'aborted', 'aborted')
  const message = e instanceof Error ? e.message : String(e)
  return new ApiClientError('client', 'internal', message)
}

function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError'
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

// biome-ignore lint/suspicious/noExplicitAny: route definitions are matched structurally
type AnyRoute = RouteDef<any, any, any, any>

export interface ApiClientOptions {
  serverUrl: string
  /** Read before each authenticated call so a token change takes effect immediately. */
  getToken: () => string | null
  fetch?: FetchLike
  /**
   * Validate every 2xx body with the route's response schema. Defaults to on unless
   * NODE_ENV is `production`: the check is for catching contract drift early, not a security layer.
   */
  validate?: boolean
  /** Called when an authenticated call answers `unauthenticated` (expired or revoked session). */
  onUnauthenticated?: () => void
}

export interface CallOptions {
  signal?: AbortSignal
}

export interface ApiClient {
  call<D extends AnyRoute>(
    route: D,
    input: RouteInput<D>,
    options?: CallOptions,
  ): Promise<RouteOutput<D>>
  readonly serverUrl: string
}

const KNOWN_CODES = new Set<string>(API_ERROR_CODES)

function defaultValidate(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.NODE_ENV
  return env !== 'production'
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const base = opts.serverUrl.replace(/\/+$/, '')
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const validate = opts.validate ?? defaultValidate()
  const routeNames = new Map<AnyRoute, ApiRouteName>(
    (Object.keys(api) as ApiRouteName[]).map((name) => [api[name] as AnyRoute, name]),
  )

  async function call<D extends AnyRoute>(
    route: D,
    input: RouteInput<D>,
    options: CallOptions = {},
  ): Promise<RouteOutput<D>> {
    const name = routeNames.get(route) ?? route.path
    const i = input as {
      params?: Record<string, string>
      query?: Record<string, unknown>
      body?: unknown
    }
    let url = base + buildPath(route.path, i.params)
    if (i.query) {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(i.query)) if (v !== undefined) qs.set(k, String(v))
      const s = qs.toString()
      if (s) url += `?${s}`
    }
    const headers: Record<string, string> = { accept: 'application/json' }
    if (route.auth) {
      const token = opts.getToken()
      if (!token) throw new ApiClientError('client', 'unauthenticated', 'not signed in', null, name)
      headers.authorization = `Bearer ${token}`
    }
    let body: string | undefined
    if (i.body !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(i.body)
    }

    let res: Response
    try {
      res = await doFetch(url, {
        method: route.method,
        headers,
        ...(body !== undefined ? { body } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      })
    } catch (e) {
      if (isAbortError(e) || options.signal?.aborted)
        throw new ApiClientError('aborted', 'aborted', 'request aborted', null, name)
      const msg = e instanceof Error ? e.message : String(e)
      throw new ApiClientError('network', 'network', msg, null, name)
    }

    let json: unknown
    try {
      json = await res.json()
    } catch (e) {
      if (isAbortError(e))
        throw new ApiClientError('aborted', 'aborted', 'request aborted', res.status, name)
      if (!res.ok) {
        // A proxy or gateway answered with a non-JSON page: still a server-side failure.
        throw new ApiClientError('server', 'internal', `HTTP ${res.status}`, res.status, name)
      }
      throw new ApiClientError(
        'contract',
        'contract_violation',
        'response is not JSON',
        res.status,
        name,
      )
    }

    if (!res.ok) {
      const parsed = ApiError.safeParse(json)
      const code: ApiErrorCode =
        parsed.success && KNOWN_CODES.has(parsed.data.error.code)
          ? parsed.data.error.code
          : 'internal'
      const message = parsed.success ? parsed.data.error.message : `HTTP ${res.status}`
      if (code === 'unauthenticated' && route.auth) opts.onUnauthenticated?.()
      throw new ApiClientError('server', code, message, res.status, name)
    }

    if (validate) {
      const parsed = route.response.safeParse(json)
      if (!parsed.success) {
        throw new ApiClientError(
          'contract',
          'contract_violation',
          `${name}: response does not match the contract: ${parsed.error.message}`,
          res.status,
          name,
        )
      }
      return parsed.data as RouteOutput<D>
    }
    return json as RouteOutput<D>
  }

  return { call, serverUrl: base }
}
