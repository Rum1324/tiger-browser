import type { AuditAction, AuditEvent, UserRef } from '@tiger/shared'
import type { Sql, TxSql } from '../db/sql'
import { newId } from '../ids'
import { type AuditRow, iso, toAuditEvent } from './rows'

export interface AuditInput {
  spaceId: string
  actor: UserRef
  action: AuditAction
  target: AuditEvent['target']
}

/** Append one event inside the caller's transaction; publish the returned event after commit. */
export async function appendAudit(tx: Sql | TxSql, input: AuditInput): Promise<AuditEvent> {
  const id = newId()
  const [row] = await tx<{ at: Date }[]>`
    insert into audit_events (id, space_id, actor_id, action, target_type, target_id, target_title, target_url)
    values (${id}, ${input.spaceId}, ${input.actor.id}, ${input.action}, ${input.target.type},
            ${input.target.id}, ${input.target.title}, ${input.target.url})
    returning at
  `
  if (!row) throw new Error('audit insert returned no row')
  return {
    id,
    spaceId: input.spaceId,
    actor: input.actor,
    action: input.action,
    target: input.target,
    at: iso(row.at),
  }
}

export async function listAudit(sql: Sql, spaceId: string, limit: number): Promise<AuditEvent[]> {
  const rows = await sql<AuditRow[]>`
    select a.id, a.space_id, a.actor_id, u.name as actor_name, u.avatar_url as actor_avatar,
           a.action, a.target_type, a.target_id, a.target_title, a.target_url, a.at
    from audit_events a join users u on u.id = a.actor_id
    where a.space_id = ${spaceId}
    order by a.at desc, a.id desc
    limit ${limit}
  `
  return rows.map(toAuditEvent)
}
