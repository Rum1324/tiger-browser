import { randomUUID } from 'node:crypto'
import type { PermissionRequest, SitePermission } from '@tiger/shared'
import { rememberedDecision } from './permission-policy'
import type { PermissionDecisions } from './store/permissions'

interface Pending {
  request: PermissionRequest
  windowId: string
  decisions: PermissionDecisions
  resolve: (allow: boolean) => void
}

export interface AskInput {
  tabId: string
  windowId: string
  origin: string
  permission: SitePermission
  decisions: PermissionDecisions
}

/** One-shot answers are reused this long, so a request Chromium makes twice prompts once. */
const RECENT_MS = 3_000

/**
 * Turns site permission requests into `permission.request` events and waits for `permission.respond`.
 * Remembered decisions answer without asking; identical concurrent requests share one prompt.
 */
export class PermissionBroker {
  private readonly pending = new Map<string, Pending>()
  private readonly recent = new Map<string, { allow: boolean; at: number }>()

  constructor(
    private readonly notify: (windowId: string, request: PermissionRequest) => void,
    private readonly now: () => number = Date.now,
  ) {}

  ask(input: AskInput): Promise<boolean> {
    const remembered = rememberedDecision(input.decisions, input.origin, input.permission)
    if (remembered !== undefined) return Promise.resolve(remembered)

    const key = `${input.tabId} ${input.origin} ${input.permission}`
    const recent = this.recent.get(key)
    if (recent && this.now() - recent.at < RECENT_MS) return Promise.resolve(recent.allow)

    for (const p of this.pending.values()) {
      const r = p.request
      if (
        r.tabId === input.tabId &&
        r.origin === input.origin &&
        r.permission === input.permission
      ) {
        return new Promise((resolve) => {
          const prev = p.resolve
          p.resolve = (allow) => {
            prev(allow)
            resolve(allow)
          }
        })
      }
    }

    return new Promise((resolve) => {
      const request: PermissionRequest = {
        requestId: randomUUID(),
        tabId: input.tabId,
        origin: input.origin,
        permission: input.permission,
      }
      this.pending.set(request.requestId, {
        request,
        windowId: input.windowId,
        decisions: input.decisions,
        resolve,
      })
      this.notify(input.windowId, request)
    })
  }

  /**
   * Answer from the UI of `windowId`. Another window's UI cannot answer for this one. An unknown id
   * (already answered, or withdrawn because the tab navigated) is ignored.
   */
  respond(requestId: string, allow: boolean, remember: boolean, windowId: string): void {
    const p = this.pending.get(requestId)
    if (!p) return
    if (p.windowId !== windowId) throw new Error('permission request belongs to another window')
    this.pending.delete(requestId)
    const { tabId, origin, permission } = p.request
    if (remember) p.decisions.set(origin, permission, allow)
    this.recent.set(`${tabId} ${origin} ${permission}`, { allow, at: this.now() })
    p.resolve(allow)
  }

  /** The tab navigated or closed: its open questions are answered "deny". */
  withdrawForTab(tabId: string): void {
    for (const [id, p] of this.pending) {
      if (p.request.tabId !== tabId) continue
      this.pending.delete(id)
      p.resolve(false)
    }
    for (const key of this.recent.keys()) if (key.startsWith(`${tabId} `)) this.recent.delete(key)
  }

  pendingCount(): number {
    return this.pending.size
  }
}
