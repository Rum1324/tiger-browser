import type { SpaceUsage } from '@tiger/shared'
import type { Sql, TxSql } from '../db/sql'
import { newId } from '../ids'
import type { AnswerUsage } from '../seams'
import { iso } from './rows'

/** Budgets run per calendar month in UTC. */
export async function getSpaceUsage(sql: Sql, spaceId: string): Promise<SpaceUsage> {
  const rows = await sql<
    { period_start: Date; input: number; output: number; budget: number | null }[]
  >`
    with period as (
      select (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC') as start
    )
    select p.start as period_start,
           coalesce((select sum(input_tokens) from llm_usage u
                     where u.space_id = s.id and u.at >= p.start), 0)::float8 as input,
           coalesce((select sum(output_tokens) from llm_usage u
                     where u.space_id = s.id and u.at >= p.start), 0)::float8 as output,
           s.token_budget::float8 as budget
    from spaces s cross join period p
    where s.id = ${spaceId}
  `
  const r = rows[0]
  if (!r) throw new Error(`space ${spaceId} not found for usage`)
  return {
    spaceId,
    periodStart: iso(r.period_start),
    inputTokens: r.input,
    outputTokens: r.output,
    budgetTokens: r.budget,
  }
}

export function budgetExceeded(u: SpaceUsage): boolean {
  return u.budgetTokens !== null && u.inputTokens + u.outputTokens >= u.budgetTokens
}

export async function recordUsage(
  tx: Sql | TxSql,
  row: {
    spaceId: string
    userId: string
    messageId: string
    provider: string
    model: string
    usage: AnswerUsage
  },
): Promise<void> {
  const u = row.usage
  await tx`
    insert into llm_usage (id, space_id, user_id, message_id, provider, model, input_tokens,
                           output_tokens, cached_input_tokens, cache_write_tokens, cost_usd)
    values (${newId()}, ${row.spaceId}, ${row.userId}, ${row.messageId}, ${row.provider}, ${row.model},
            ${u.inputTokens}, ${u.outputTokens}, ${u.cachedInputTokens}, ${u.cacheWriteTokens ?? 0},
            ${u.costUsd ?? null})
  `
}
