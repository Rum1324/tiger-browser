import { z } from 'zod'
import { AuditEvent, Citation, Id, Item, Message, Thread, TokenUsage, UserRef } from './domain'

/**
 * WebSocket protocol at `/v1/ws`. The client authenticates with the first frame, then subscribes to
 * Spaces. Events for a private thread go only to its owner's sockets.
 */

export const ClientEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string() }),
  z.object({ type: z.literal('subscribe'), spaceIds: z.array(Id).max(100) }),
  z.object({ type: z.literal('ping') }),
])
export type ClientEvent = z.infer<typeof ClientEvent>

export const ServerEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), userId: Id }),
  z.object({ type: z.literal('pong') }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),

  z.object({ type: z.literal('thread.created'), thread: Thread }),
  z.object({ type: z.literal('thread.updated'), thread: Thread }),
  z.object({ type: z.literal('thread.deleted'), spaceId: Id, threadId: Id }),

  z.object({ type: z.literal('message.created'), spaceId: Id, message: Message }),
  /** Appended text for a streaming assistant message. `seq` increases by one per delta. */
  z.object({
    type: z.literal('message.delta'),
    spaceId: Id,
    threadId: Id,
    messageId: Id,
    seq: z.number().int().nonnegative(),
    text: z.string(),
  }),
  /** Sources become known before the text finishes; the UI can resolve `[n]` chips as they arrive. */
  z.object({
    type: z.literal('message.sources'),
    spaceId: Id,
    threadId: Id,
    messageId: Id,
    citations: z.array(Citation),
  }),
  z.object({
    type: z.literal('message.completed'),
    spaceId: Id,
    message: Message,
    usage: TokenUsage.nullable(),
  }),
  z.object({
    type: z.literal('message.failed'),
    spaceId: Id,
    threadId: Id,
    messageId: Id,
    code: z.string(),
    message: z.string(),
  }),

  z.object({ type: z.literal('item.upserted'), item: Item }),
  z.object({ type: z.literal('item.deleted'), spaceId: Id, itemId: Id, url: z.string() }),

  z.object({ type: z.literal('member.joined'), spaceId: Id, user: UserRef }),
  z.object({ type: z.literal('member.removed'), spaceId: Id, userId: Id }),
  z.object({ type: z.literal('audit.appended'), event: AuditEvent }),
])
export type ServerEvent = z.infer<typeof ServerEvent>
export type ServerEventOf<T extends ServerEvent['type']> = Extract<ServerEvent, { type: T }>
