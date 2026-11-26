import type { DatabaseSync } from 'node:sqlite'
import type { SitePermission } from '@tiger/shared'

/** Remembered site-permission decisions, keyed by origin and permission. */
export interface PermissionDecisions {
  get(origin: string, permission: SitePermission): boolean | undefined
  set(origin: string, permission: SitePermission, allow: boolean): void
}

export class PermissionStore implements PermissionDecisions {
  constructor(private readonly db: DatabaseSync) {}

  get(origin: string, permission: SitePermission): boolean | undefined {
    const row = this.db
      .prepare('SELECT allow FROM permissions WHERE origin = ? AND permission = ?')
      .get(origin, permission) as { allow: number } | undefined
    return row === undefined ? undefined : row.allow === 1
  }

  set(origin: string, permission: SitePermission, allow: boolean): void {
    this.db
      .prepare(
        `INSERT INTO permissions (origin, permission, allow, decided_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(origin, permission) DO UPDATE SET allow = excluded.allow, decided_at = excluded.decided_at`,
      )
      .run(origin, permission, allow ? 1 : 0, new Date().toISOString())
  }
}

/** Private windows remember decisions only for the life of their session. */
export class MemoryPermissionStore implements PermissionDecisions {
  private readonly map = new Map<string, boolean>()

  get(origin: string, permission: SitePermission): boolean | undefined {
    return this.map.get(`${origin} ${permission}`)
  }

  set(origin: string, permission: SitePermission, allow: boolean): void {
    this.map.set(`${origin} ${permission}`, allow)
  }
}
