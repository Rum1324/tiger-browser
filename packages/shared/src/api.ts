import { z } from 'zod'
import {
  AuditEvent,
  ExtractedPage,
  Id,
  Invite,
  Item,
  ItemDetail,
  ItemVersionRef,
  Locale,
  Message,
  ModelInfo,
  ModelRef,
  PageAttachmentInput,
  Space,
  SpaceHue,
  SpaceMember,
  SpaceUsage,
  Thread,
  ThreadVisibility,
  User,
} from './domain'

/**
 * The REST contract. The server registers handlers from these definitions and the client calls through
 * them, so a mismatch is a compile error on one side or the other.
 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export interface RouteDef<P, Q, B, R> {
  method: HttpMethod
  /** Express-style path under the API root, e.g. `/v1/spaces/:spaceId/items`. */
  path: string
  /** False only for the sign-in routes and health. */
  auth: boolean
  params?: z.ZodType<P>
  query?: z.ZodType<Q>
  body?: z.ZodType<B>
  response: z.ZodType<R>
}

function route<P = undefined, Q = undefined, B = undefined, R = unknown>(def: {
  method: HttpMethod
  path: string
  auth?: boolean
  params?: z.ZodType<P>
  query?: z.ZodType<Q>
  body?: z.ZodType<B>
  response: z.ZodType<R>
}): RouteDef<P, Q, B, R> {
  return { auth: true, ...def }
}

type Part<K extends string, T> = [T] extends [undefined]
  ? { [k in K]?: undefined }
  : { [k in K]: T }

export type RouteInput<D> =
  D extends RouteDef<infer P, infer Q, infer B, unknown>
    ? Part<'params', P> & { query?: Q } & Part<'body', B>
    : never
export type RouteOutput<D> = D extends RouteDef<unknown, unknown, unknown, infer R> ? R : never

const Ok = z.object({ ok: z.literal(true) })
const SpaceParams = z.object({ spaceId: Id })
const ItemParams = z.object({ itemId: Id })
const ThreadParams = z.object({ threadId: Id })

export const AuthSession = z.object({
  /** Opaque bearer token. The client stores it with the OS keychain (Electron safeStorage). */
  token: z.string().min(20),
  user: User,
})
export type AuthSession = z.infer<typeof AuthSession>

export const ShareItemResult = z.object({
  item: Item,
  /** `new`: first share of this URL in the Space. `version`: content changed. `unchanged`: same hash. */
  outcome: z.enum(['new', 'version', 'unchanged']),
})
export type ShareItemResult = z.infer<typeof ShareItemResult>

export const SearchHit = z.object({
  itemId: Id,
  itemVersionId: Id,
  chunkId: Id,
  title: z.string(),
  url: z.string(),
  headingPath: z.string(),
  text: z.string(),
  score: z.number(),
})
export type SearchHit = z.infer<typeof SearchHit>

export const PostMessageBody = z.object({
  content: z.string().min(1).max(20_000),
  /** When true the server generates an assistant reply and streams it over the WebSocket. */
  askAi: z.boolean(),
  model: ModelRef.optional(),
  /** Private threads only; the server rejects attachments on a Space thread. */
  attachments: z.array(PageAttachmentInput).max(3).optional(),
})
export type PostMessageBody = z.infer<typeof PostMessageBody>

export const api = {
  health: route({
    method: 'GET',
    path: '/v1/health',
    auth: false,
    response: z.object({ ok: z.literal(true), version: z.string() }),
  }),

  // ── Auth ──
  authGoogle: route({
    method: 'POST',
    path: '/v1/auth/google',
    auth: false,
    body: z.object({ idToken: z.string().min(10) }),
    response: AuthSession,
  }),
  /** Enabled only when the server runs with AUTH_DEV_LOGIN=1. */
  authDev: route({
    method: 'POST',
    path: '/v1/auth/dev',
    auth: false,
    body: z.object({ email: z.email(), name: z.string().min(1).max(120) }),
    response: AuthSession,
  }),
  authLogout: route({ method: 'POST', path: '/v1/auth/logout', response: Ok }),
  me: route({
    method: 'GET',
    path: '/v1/me',
    response: z.object({ user: User, spaces: z.array(Space) }),
  }),
  updateMe: route({
    method: 'PATCH',
    path: '/v1/me',
    body: z.object({ name: z.string().min(1).max(120).optional(), locale: Locale.optional() }),
    response: User,
  }),

  // ── Models ──
  listModels: route({
    method: 'GET',
    path: '/v1/models',
    response: z.object({
      models: z.array(ModelInfo) /** Null when no provider is configured. */,
      defaultModel: ModelRef.nullable(),
    }),
  }),

  // ── Spaces ──
  listSpaces: route({ method: 'GET', path: '/v1/spaces', response: z.array(Space) }),
  createSpace: route({
    method: 'POST',
    path: '/v1/spaces',
    body: z.object({ name: z.string().min(1).max(80), hue: SpaceHue.optional() }),
    response: Space,
  }),
  getSpace: route({
    method: 'GET',
    path: '/v1/spaces/:spaceId',
    params: SpaceParams,
    response: z.object({
      space: Space,
      members: z.array(SpaceMember),
      pendingInvites: z.array(Invite),
    }),
  }),
  updateSpace: route({
    method: 'PATCH',
    path: '/v1/spaces/:spaceId',
    params: SpaceParams,
    body: z.object({ name: z.string().min(1).max(80).optional(), hue: SpaceHue.optional() }),
    response: Space,
  }),
  createInvite: route({
    method: 'POST',
    path: '/v1/spaces/:spaceId/invites',
    params: SpaceParams,
    body: z.object({ email: z.email().optional() }),
    /** The token appears in this response once; the server stores only its hash. */
    response: z.object({ invite: Invite, token: z.string(), url: z.string() }),
  }),
  revokeInvite: route({
    method: 'DELETE',
    path: '/v1/spaces/:spaceId/invites/:inviteId',
    params: z.object({ spaceId: Id, inviteId: Id }),
    response: Ok,
  }),
  acceptInvite: route({
    method: 'POST',
    path: '/v1/invites/accept',
    body: z.object({ token: z.string().min(10) }),
    response: Space,
  }),
  removeMember: route({
    method: 'DELETE',
    path: '/v1/spaces/:spaceId/members/:userId',
    params: z.object({ spaceId: Id, userId: Id }),
    response: Ok,
  }),

  // ── Shared items ──
  shareItem: route({
    method: 'POST',
    path: '/v1/spaces/:spaceId/items',
    params: SpaceParams,
    body: z.object({ page: ExtractedPage }),
    response: ShareItemResult,
  }),
  listItems: route({
    method: 'GET',
    path: '/v1/spaces/:spaceId/items',
    params: SpaceParams,
    response: z.array(Item),
  }),
  /** Which Spaces already hold this URL: drives the per-tab shared state in the UI. */
  lookupItemsByUrl: route({
    method: 'POST',
    path: '/v1/items/lookup',
    body: z.object({ urls: z.array(z.string()).min(1).max(100) }),
    response: z.array(
      z.object({ url: z.string(), itemId: Id, spaceId: Id, sharedBy: Id, updatedAt: z.string() }),
    ),
  }),
  getItem: route({
    method: 'GET',
    path: '/v1/items/:itemId',
    params: ItemParams,
    response: ItemDetail,
  }),
  listItemVersions: route({
    method: 'GET',
    path: '/v1/items/:itemId/versions',
    params: ItemParams,
    response: z.array(ItemVersionRef),
  }),
  /** Unshare: deletes the content, every version and every embedding. An audit tombstone remains. */
  unshareItem: route({
    method: 'DELETE',
    path: '/v1/items/:itemId',
    params: ItemParams,
    response: Ok,
  }),
  listAudit: route({
    method: 'GET',
    path: '/v1/spaces/:spaceId/audit',
    params: SpaceParams,
    query: z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }),
    response: z.array(AuditEvent),
  }),
  search: route({
    method: 'POST',
    path: '/v1/spaces/:spaceId/search',
    params: SpaceParams,
    body: z.object({
      query: z.string().min(1).max(1000),
      k: z.number().int().min(1).max(30).optional(),
    }),
    response: z.array(SearchHit),
  }),
  getUsage: route({
    method: 'GET',
    path: '/v1/spaces/:spaceId/usage',
    params: SpaceParams,
    response: SpaceUsage,
  }),

  // ── Threads and messages ──
  listThreads: route({
    method: 'GET',
    path: '/v1/spaces/:spaceId/threads',
    params: SpaceParams,
    query: z.object({ visibility: ThreadVisibility.optional() }),
    response: z.array(Thread),
  }),
  createThread: route({
    method: 'POST',
    path: '/v1/spaces/:spaceId/threads',
    params: SpaceParams,
    body: z.object({ visibility: ThreadVisibility, title: z.string().max(200).optional() }),
    response: Thread,
  }),
  listMessages: route({
    method: 'GET',
    path: '/v1/threads/:threadId/messages',
    params: ThreadParams,
    query: z.object({
      /** A message id: return the messages older than it. */
      before: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
    response: z.array(Message),
  }),
  postMessage: route({
    method: 'POST',
    path: '/v1/threads/:threadId/messages',
    params: ThreadParams,
    body: PostMessageBody,
    response: z.object({
      message: Message,
      /** Present when askAi was true: the placeholder the stream will fill. */
      assistantMessage: Message.nullable(),
    }),
  }),
  /** Promote a private thread to the Space. Page attachments are not carried over. */
  shareThread: route({
    method: 'POST',
    path: '/v1/threads/:threadId/share',
    params: ThreadParams,
    response: Thread,
  }),
  deleteThread: route({
    method: 'DELETE',
    path: '/v1/threads/:threadId',
    params: ThreadParams,
    response: Ok,
  }),
  /** Record that an answer left for Google Docs (the upload itself happens on the member's machine). */
  recordExport: route({
    method: 'POST',
    path: '/v1/spaces/:spaceId/exports',
    params: SpaceParams,
    body: z.object({ messageId: Id.optional(), title: z.string().max(300), url: z.string() }),
    response: Ok,
  }),
} as const

export type ApiRouteName = keyof typeof api

/** Every `error.code` the server can return. The UI maps each to a message. */
export const API_ERROR_CODES = [
  'invalid_request',
  'unauthenticated',
  'forbidden',
  'not_found',
  'space_not_found',
  'item_not_found',
  'thread_not_found',
  'invite_not_found',
  'invite_expired',
  'invite_revoked',
  'invite_used',
  'invite_email_mismatch',
  'member_not_found',
  'last_owner',
  'capture_blocked',
  'attachments_not_allowed',
  'already_shared',
  'budget_exceeded',
  'model_unavailable',
  'ai_unavailable',
  'dev_login_disabled',
  'google_auth_unavailable',
  'google_token_invalid',
  'rate_limited',
  'payload_too_large',
  'contract_violation',
  'internal',
] as const
export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

export const ApiError = z.object({
  error: z.object({
    /** One of API_ERROR_CODES. */
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
  }),
})
export type ApiError = z.infer<typeof ApiError>

/** Fill `:name` segments of a route path. */
export function buildPath(path: string, params: Record<string, string> | undefined): string {
  return path.replace(/:([A-Za-z]+)/g, (_, key: string) => {
    const value = params?.[key]
    if (value === undefined) throw new Error(`missing path parameter: ${key}`)
    return encodeURIComponent(value)
  })
}
