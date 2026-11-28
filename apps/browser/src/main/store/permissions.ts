import type { DatabaseSync } from 'node:sqlite'
import { type RememberedPermission, SitePermission } from '@tiger/shared'

/** Remembered site-permission decisions, keyed by origin and permission. */
export interface PermissionDecisions {
  get(origin: string, permission: SitePermission): boolean | undefined
  set(origin: string, permission: SitePermission, allow: boolean): void
  /** Every remembered decision, newest first (Settings lists them). */
  list(): RememberedPermission[]
  /** Forget one decision: the site is asked again next time. */
  revoke(origin: string, permission: SitePermission): void
}

export class PermissionStore implements PermissionDecisions {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

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
      .run(origin, permission, allow ? 1 : 0, this.now().toISOString())
  }

  list(): RememberedPermission[] {
    const rows = this.db
      .prepare(
        'SELECT origin, permission, allow, decided_at FROM permissions ORDER BY decided_at DESC, origin, permission',
      )
      .all() as { origin: string; permission: string; allow: number; decided_at: string }[]
    const out: RememberedPermission[] = []
    for (const r of rows) {
      // A row written by an older build for a permission the contract no longer has is not listed.
      const permission = SitePermission.safeParse(r.permission)
      if (!permission.success) continue
      out.push({
        origin: r.origin,
        permission: permission.data,
        allow: r.allow === 1,
        decidedAt: r.decided_at,
      })
    }
    return out
  }

  revoke(origin: string, permission: SitePermission): void {
    this.db
      .prepare('DELETE FROM permissions WHERE origin = ? AND permission = ?')
      .run(origin, permission)
  }
}

/** Decisions held in memory by one instance (tests, and anything that must not touch disk). */
export class MemoryPermissionStore implements PermissionDecisions {
  private readonly map = new Map<string, RememberedPermission>()

  constructor(private readonly now: () => Date = () => new Date()) {}

  get(origin: string, permission: SitePermission): boolean | undefined {
    return this.map.get(`${origin} ${permission}`)?.allow
  }

  set(origin: string, permission: SitePermission, allow: boolean): void {
    const key = `${origin} ${permission}`
    // Re-inserted so iteration order stays oldest first.
    this.map.delete(key)
    this.map.set(key, { origin, permission, allow, decidedAt: this.now().toISOString() })
  }

  list(): RememberedPermission[] {
    return [...this.map.values()].reverse()
  }

  revoke(origin: string, permission: SitePermission): void {
    this.map.delete(`${origin} ${permission}`)
  }
}

/**
 * A private window remembers nothing: "remember this decision" is ignored there, so every request
 * asks again (the broker still folds a burst of identical requests into one prompt).
 */
export class ForgetfulPermissionStore implements PermissionDecisions {
  get(_origin: string, _permission: SitePermission): boolean | undefined {
    return undefined
  }
  set(_origin: string, _permission: SitePermission, _allow: boolean): void {}
  list(): RememberedPermission[] {
    return []
  }
  revoke(_origin: string, _permission: SitePermission): void {}
}
