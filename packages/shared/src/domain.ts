import { z } from 'zod'

/** Server-issued identifiers are UUIDs. */
export const Id = z.uuid()
export type Id = z.infer<typeof Id>

export const IsoDate = z.iso.datetime()
export type IsoDate = z.infer<typeof IsoDate>

export const Locale = z.enum(['ja', 'en'])
export type Locale = z.infer<typeof Locale>

// ── People ──────────────────────────────────────────────────────────────────

export const UserRef = z.object({
  id: Id,
  name: z.string().min(1).max(120),
  avatarUrl: z.string().nullable(),
})
export type UserRef = z.infer<typeof UserRef>

export const User = UserRef.extend({
  email: z.email(),
  locale: Locale,
})
export type User = z.infer<typeof User>

// ── Spaces ──────────────────────────────────────────────────────────────────

/** A Space's identity colour is stored as a key; the design tokens decide what it looks like. */
export const SpaceHue = z.enum([
  'amber',
  'coral',
  'rose',
  'violet',
  'indigo',
  'sky',
  'teal',
  'green',
  'graphite',
])
export type SpaceHue = z.infer<typeof SpaceHue>

export const SpaceRole = z.enum(['owner', 'member'])
export type SpaceRole = z.infer<typeof SpaceRole>

export const Space = z.object({
  id: Id,
  name: z.string().min(1).max(80),
  hue: SpaceHue,
  createdBy: Id,
  createdAt: IsoDate,
  memberCount: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  myRole: SpaceRole,
})
export type Space = z.infer<typeof Space>

export const SpaceMember = z.object({
  user: UserRef.extend({ email: z.email() }),
  role: SpaceRole,
  joinedAt: IsoDate,
})
export type SpaceMember = z.infer<typeof SpaceMember>

export const Invite = z.object({
  id: Id,
  spaceId: Id,
  email: z.email().nullable(),
  createdBy: UserRef,
  createdAt: IsoDate,
  expiresAt: IsoDate,
  acceptedAt: IsoDate.nullable(),
})
export type Invite = z.infer<typeof Invite>

// ── Captured content ────────────────────────────────────────────────────────

export const SourceType = z.enum([
  'web',
  'google-doc',
  'google-sheet',
  'google-slides',
  'slack',
  'notion',
  'pdf',
  'other',
])
export type SourceType = z.infer<typeof SourceType>

/** Upper bound on one captured page. The extractor truncates and sets `truncated`. */
export const MAX_MARKDOWN_CHARS = 600_000

/**
 * The exact payload that leaves the machine when a member shares a page.
 * The share preview renders this object and nothing else is sent.
 */
export const ExtractedPage = z.object({
  url: z.url(),
  title: z.string().max(500),
  sourceType: SourceType,
  markdown: z.string().max(MAX_MARKDOWN_CHARS),
  lang: z.string().max(16).nullable(),
  byline: z.string().max(200).nullable(),
  siteName: z.string().max(200).nullable(),
  /** Which extractor produced this, e.g. `readability@1`, `google-docs-export@1`. */
  extractor: z.string().max(64),
  capturedAt: IsoDate,
  charCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
})
export type ExtractedPage = z.infer<typeof ExtractedPage>

export const ItemStatus = z.enum(['indexing', 'ready', 'failed'])
export type ItemStatus = z.infer<typeof ItemStatus>

export const ItemVersionRef = z.object({
  id: Id,
  number: z.number().int().positive(),
  charCount: z.number().int().nonnegative(),
  contentHash: z.string(),
  capturedAt: IsoDate,
  capturedBy: UserRef,
})
export type ItemVersionRef = z.infer<typeof ItemVersionRef>

/** A shared item: one URL in one Space, with provenance. */
export const Item = z.object({
  id: Id,
  spaceId: Id,
  url: z.string(),
  title: z.string(),
  sourceType: SourceType,
  sharedBy: UserRef,
  sharedAt: IsoDate,
  updatedAt: IsoDate,
  status: ItemStatus,
  versionCount: z.number().int().positive(),
  currentVersion: ItemVersionRef,
})
export type Item = z.infer<typeof Item>

export const ItemDetail = Item.extend({
  markdown: z.string(),
  extractor: z.string(),
  lang: z.string().nullable(),
})
export type ItemDetail = z.infer<typeof ItemDetail>

// ── Models ──────────────────────────────────────────────────────────────────

export const Provider = z.enum(['anthropic', 'openai', 'google', 'mock'])
export type Provider = z.infer<typeof Provider>

export const ModelRef = z.object({
  provider: Provider,
  id: z.string().min(1).max(120),
})
export type ModelRef = z.infer<typeof ModelRef>

export const ModelInfo = ModelRef.extend({
  label: z.string(),
  tier: z.enum(['best', 'fast']),
  contextWindow: z.number().int().positive(),
  /** False when the server has no key for this provider; the picker shows it disabled. */
  available: z.boolean(),
})
export type ModelInfo = z.infer<typeof ModelInfo>

// ── Conversation ────────────────────────────────────────────────────────────

/**
 * `private`: the side-panel thread of one member, scoped to a Space, visible to its owner only.
 * `space`: visible to every member of the Space.
 * Only private threads may carry page attachments; a Space thread can use shared items only.
 */
export const ThreadVisibility = z.enum(['private', 'space'])
export type ThreadVisibility = z.infer<typeof ThreadVisibility>

export const Thread = z.object({
  id: Id,
  spaceId: Id,
  visibility: ThreadVisibility,
  owner: UserRef,
  title: z.string().max(200),
  createdAt: IsoDate,
  lastMessageAt: IsoDate.nullable(),
})
export type Thread = z.infer<typeof Thread>

/** One numbered source an AI answer points at. `n` matches the `[n]` marker in the text. */
export const Citation = z.object({
  n: z.number().int().positive(),
  itemId: Id,
  itemVersionId: Id,
  title: z.string(),
  url: z.string(),
  sourceType: SourceType,
  sharedBy: UserRef,
  sharedAt: IsoDate,
  /** The passage the answer relied on. Emptied when the item is unshared. */
  quote: z.string().max(600),
  /** False once the item has been unshared: the chip stays, its content is gone. */
  available: z.boolean(),
})
export type Citation = z.infer<typeof Citation>

/** What the client sends when attaching the current page to one message (private threads only). */
export const PageAttachmentInput = ExtractedPage
export type PageAttachmentInput = z.infer<typeof PageAttachmentInput>

/** What the server echoes back: metadata only, never the content. */
export const PageAttachment = z.object({
  url: z.string(),
  title: z.string(),
  sourceType: SourceType,
  charCount: z.number().int().nonnegative(),
})
export type PageAttachment = z.infer<typeof PageAttachment>

export const TokenUsage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
})
export type TokenUsage = z.infer<typeof TokenUsage>

export const MessageStatus = z.enum(['streaming', 'complete', 'error'])
export type MessageStatus = z.infer<typeof MessageStatus>

export const Message = z.object({
  id: Id,
  threadId: Id,
  role: z.enum(['user', 'assistant']),
  /** The member who wrote it (user message) or who asked for it (assistant message). */
  author: UserRef,
  model: ModelRef.nullable(),
  content: z.string(),
  citations: z.array(Citation),
  attachments: z.array(PageAttachment),
  status: MessageStatus,
  errorCode: z.string().nullable(),
  usage: TokenUsage.nullable(),
  createdAt: IsoDate,
})
export type Message = z.infer<typeof Message>

// ── Audit ───────────────────────────────────────────────────────────────────

export const AuditAction = z.enum([
  'space.created',
  'member.invited',
  'member.joined',
  'member.removed',
  'item.shared',
  'item.reshared',
  'item.unshared',
  'thread.shared',
  'export.google_doc',
])
export type AuditAction = z.infer<typeof AuditAction>

export const AuditEvent = z.object({
  id: Id,
  spaceId: Id,
  actor: UserRef,
  action: AuditAction,
  /** Enough to render the line after the target itself is gone (an unshared item keeps its title and URL). */
  target: z.object({
    type: z.enum(['space', 'member', 'item', 'thread', 'export']),
    id: z.string(),
    title: z.string().nullable(),
    url: z.string().nullable(),
  }),
  at: IsoDate,
})
export type AuditEvent = z.infer<typeof AuditEvent>

export const SpaceUsage = z.object({
  spaceId: Id,
  periodStart: IsoDate,
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** Token budget for the period; null means unlimited. */
  budgetTokens: z.number().int().positive().nullable(),
})
export type SpaceUsage = z.infer<typeof SpaceUsage>
