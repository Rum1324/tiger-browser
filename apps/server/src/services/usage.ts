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

/** A reservation older than this no longer holds budget (an answer never runs this long). */
const RESERVATION_TTL = '30 minutes'

/**
 * Hold `tokens` of the Space's monthly budget for one answer before the provider is called. The
 * Space row is locked, so concurrent answers are checked one after another against the tokens
 * already spent plus those reserved by answers still running. Returns false when nothing is left;
 * the answer must then not call the provider. An unlimited Space reserves nothing.
 */
export async function reserveBudget(
  sql: Sql,
  r: { spaceId: string; messageId: string; tokens: number },
): Promise<boolean> {
  return sql.begin(async (tx) => {
    const [space] = await tx<{ budget: number | null }[]>`
      select token_budget::float8 as budget from spaces where id = ${r.spaceId} for update
    `
    if (!space) return false
    if (space.budget === null) return true
    const [row] = await tx<{ used: number; reserved: number }[]>`
      select
        coalesce((select sum(input_tokens + output_tokens) from llm_usage
                  where space_id = ${r.spaceId}
                    and at >= (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC')), 0)::float8 as used,
        coalesce((select sum(tokens) from llm_reservations
                  where space_id = ${r.spaceId} and message_id <> ${r.messageId}
                    and at > now() - ${RESERVATION_TTL}::interval), 0)::float8 as reserved
    `
    if ((row?.used ?? 0) + (row?.reserved ?? 0) >= space.budget) return false
    await tx`
      insert into llm_reservations (message_id, space_id, tokens)
      values (${r.messageId}, ${r.spaceId}, ${Math.max(1, Math.ceil(r.tokens))})
      on conflict (message_id) do update set tokens = excluded.tokens, at = now()
    `
    return true
  })
}

/** Drop an answer's reservation; call in the transaction that records its real usage. */
export async function releaseReservation(tx: Sql | TxSql, messageId: string): Promise<void> {
  await tx`delete from llm_reservations where message_id = ${messageId}`
}
