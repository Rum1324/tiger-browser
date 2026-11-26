import { Provider } from '@tiger/shared'
import { z } from 'zod'
import rawCatalog from './catalog.json' with { type: 'json' }
import type { ChatUsage } from './types'

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const Price = z.object({
  /** First UTC day this row applies; a row stays in force until the next row's day. */
  effectiveFrom: isoDay,
  inputPerMTok: z.number().nonnegative(),
  outputPerMTok: z.number().nonnegative(),
  /** Cached-read price as a multiple of the input price. It differs per model (0.025 to 0.1). */
  cacheReadMultiplier: z.number().nonnegative(),
  /** Cache-write price as a multiple of the input price (1 = no premium). */
  cacheWriteMultiplier: z.number().nonnegative(),
  /** The whole request is billed at these rates when its prompt exceeds the threshold. */
  longContext: z
    .object({
      overPromptTokens: z.number().int().positive(),
      inputPerMTok: z.number().nonnegative(),
      outputPerMTok: z.number().nonnegative(),
    })
    .optional(),
  source: z.string(),
})
export type PriceRow = z.infer<typeof Price>

const ChatTuning = z.object({
  /**
   * off: send the provider's "no thinking" setting. between_tools: Anthropic's reduced mode.
   * on: the model always reasons, so output budgets must leave room for it.
   */
  reasoning: z.enum(['off', 'between_tools', 'on']),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  defaultMaxOutputTokens: z.number().int().positive(),
  /** Floor for max output tokens when the model can reason: reasoning is billed inside the cap. */
  minOutputTokens: z.number().int().positive().optional(),
})

export const CatalogModel = z.object({
  provider: Provider,
  id: z.string().min(1),
  label: z.string().min(1),
  tier: z.enum(['best', 'fast']),
  contextWindow: z.number().int().positive(),
  maxOutput: z.number().int().positive(),
  /** True only when this exact id was called successfully with a real key by this project. */
  verified: z.boolean(),
  verifiedNote: z.string(),
  /** Lower wins when picking defaultModel() among available models. */
  defaultRank: z.number().int().optional(),
  chat: ChatTuning,
  prices: z.array(Price).min(1),
})
export type CatalogModel = z.infer<typeof CatalogModel>

export const CatalogFile = z.object({
  updatedOn: isoDay,
  models: z.array(CatalogModel).min(1),
})

export interface Catalog {
  updatedOn: string
  models: readonly CatalogModel[]
}

/** Validates a catalog document and sorts each price list by date. Throws on a malformed file. */
export function parseCatalog(raw: unknown): Catalog {
  const file = CatalogFile.parse(raw)
  const seen = new Set<string>()
  const models = file.models.map((m) => {
    const key = `${m.provider}/${m.id}`
    if (seen.has(key)) throw new Error(`Duplicate catalog model ${key}`)
    seen.add(key)
    return {
      ...m,
      prices: [...m.prices].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)),
    }
  })
  return { updatedOn: file.updatedOn, models }
}

export const defaultCatalog: Catalog = parseCatalog(rawCatalog)

export function findModel(
  catalog: Catalog,
  ref: { provider: string; id: string },
): CatalogModel | undefined {
  return catalog.models.find((m) => m.provider === ref.provider && m.id === ref.id)
}

function toDay(at: Date | string | number): string {
  if (typeof at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(at)) return at
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${String(at)}`)
  return d.toISOString().slice(0, 10)
}

/**
 * The row in force on `at`. A date before the first row gets the first row: the catalog does not
 * know older prices, and the earliest known one is the closest honest answer.
 */
export function priceAt(model: CatalogModel, at: Date | string | number): PriceRow {
  const day = toDay(at)
  let current = model.prices[0] as PriceRow
  for (const row of model.prices) {
    if (row.effectiveFrom <= day) current = row
  }
  return current
}

/** USD for one request. Input is split into fresh, cache-read and cache-write parts. */
export function computeCostUsd(
  model: CatalogModel,
  usage: ChatUsage,
  at: Date | string | number,
): number {
  const p = priceAt(model, at)
  const long =
    p.longContext && usage.inputTokens > p.longContext.overPromptTokens ? p.longContext : null
  const inPrice = long?.inputPerMTok ?? p.inputPerMTok
  const outPrice = long?.outputPerMTok ?? p.outputPerMTok
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens)
  const written = Math.min(usage.cacheWriteTokens, usage.inputTokens - cached)
  const fresh = usage.inputTokens - cached - written
  const usd =
    (fresh * inPrice +
      cached * inPrice * p.cacheReadMultiplier +
      written * inPrice * p.cacheWriteMultiplier +
      usage.outputTokens * outPrice) /
    1_000_000
  return usd
}

/** Max output tokens to send: the request's wish, floored for reasoning models, capped by the model. */
export function resolveMaxOutputTokens(model: CatalogModel, requested: number | undefined): number {
  const wanted = requested ?? model.chat.defaultMaxOutputTokens
  const floor = model.chat.reasoning === 'off' ? 0 : (model.chat.minOutputTokens ?? 0)
  return Math.min(Math.max(wanted, floor), model.maxOutput)
}
