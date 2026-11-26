import type { RouteDef, RouteInput, User } from '@tiger/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { z } from 'zod'
import { type ResolvedSession, resolveSession } from '../auth/sessions'
import { AppError } from '../errors'

export interface HandlerContext {
  req: FastifyRequest
  reply: FastifyReply
  /** The signed-in user. Throws on a route whose contract has `auth: false`. */
  readonly user: User
  /** SHA-256 of the bearer token of this request; same rule as `user`. */
  readonly sessionHash: Buffer
}

export type RouteHandler<P, Q, B, R> = (
  input: RouteInput<RouteDef<P, Q, B, R>>,
  ctx: HandlerContext,
) => Promise<R>

export interface RouteOptions {
  /** Requests per minute per client IP; applied to sign-in and other token-guessing targets. */
  rateLimitPerMinute?: number
}

function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization
  if (!header) return null
  const m = /^Bearer\s+(\S+)$/i.exec(header)
  return m?.[1] ?? null
}

/** Lists paths and messages only: request values may be secrets or page content. */
export function describeZodError(err: z.ZodError): string {
  return err.issues
    .slice(0, 5)
    .map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('; ')
}

function parsePart<T>(schema: z.ZodType<T> | undefined, value: unknown, part: string): T {
  if (!schema) return undefined as T
  const r = schema.safeParse(value ?? (part === 'body' ? undefined : {}))
  if (!r.success)
    throw new AppError(400, 'invalid_request', `${part}: ${describeZodError(r.error)}`)
  return r.data
}

/**
 * Register one contract route. Params, query and body are parsed with the contract's schemas, auth is
 * enforced when the contract says so, and outside production the handler's result is checked against
 * the response schema so a drift between server and contract fails the request instead of reaching a
 * client.
 */
export function registerRoute<P, Q, B, R>(
  app: FastifyInstance,
  def: RouteDef<P, Q, B, R>,
  handler: RouteHandler<P, Q, B, R>,
  opts: RouteOptions = {},
): void {
  const { sql, config, log } = app.tiger
  const checkResponse = config.env !== 'production'

  app.route({
    method: def.method,
    url: def.path,
    config: opts.rateLimitPerMinute
      ? { rateLimit: { max: opts.rateLimitPerMinute, timeWindow: 60_000 } }
      : {},
    handler: async (req, reply) => {
      let session: ResolvedSession | null = null
      if (def.auth) {
        const token = bearerToken(req)
        session = token ? await resolveSession(sql, token) : null
        if (!session) throw new AppError(401, 'unauthenticated', 'Sign in required')
      }
      const input = {
        params: parsePart(def.params, req.params, 'params'),
        query: parsePart(def.query, req.query, 'query'),
        body: parsePart(def.body, req.body, 'body'),
      } as RouteInput<RouteDef<P, Q, B, R>>

      const ctx: HandlerContext = {
        req,
        reply,
        get user() {
          if (!session) throw new Error(`route ${def.path} has no signed-in user`)
          return session.user
        },
        get sessionHash() {
          if (!session) throw new Error(`route ${def.path} has no session`)
          return session.tokenHash
        },
      }
      const result = await handler(input, ctx)
      if (checkResponse) {
        const r = def.response.safeParse(result)
        if (!r.success) {
          log.error(
            { route: `${def.method} ${def.path}`, issues: r.error.issues },
            'response does not match the contract',
          )
          throw new AppError(
            500,
            'contract_violation',
            `response of ${def.path} breaks the contract`,
          )
        }
      }
      return reply.send(result)
    },
  })
  app.contractRoutes.add(def as RouteDef<unknown, unknown, unknown, unknown>)
}
