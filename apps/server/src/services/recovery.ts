import type { AppContext } from '../context'
import { reindexItem } from './items'

/**
 * Settle work a previous process left unfinished. Call once at startup, before listening.
 *
 * - Assistant messages still `streaming`: their stream buffer lived in the dead process's memory, so
 *   nothing will ever finish them. They end as `error` / `ai_interrupted`. This assumes one server
 *   instance per database; several instances would need an instance id or lease on the row.
 * - Budget reservations of those answers are dropped.
 * - Items still `indexing` (shutdown or crash mid-run) or `failed`: indexed again in the background
 *   from their stored current version.
 */
export async function recoverInterruptedWork(
  ctx: AppContext,
): Promise<{ messages: number; items: number }> {
  const settled = await ctx.sql`
    update messages set status = 'error', error_code = 'ai_interrupted'
    where status = 'streaming'
    returning id
  `
  // Reservations of answers that died with the previous process.
  await ctx.sql`delete from llm_reservations`
  const items = await ctx.sql<{ id: string }[]>`
    select id from items where status in ('indexing', 'failed') order by updated_at
  `
  let queued = 0
  for (const { id } of items) if (await reindexItem(ctx, id)) queued++
  if (settled.length > 0 || queued > 0) {
    ctx.log.info({ messages: settled.length, items: queued }, 'recovered interrupted work')
  }
  return { messages: settled.length, items: queued }
}
