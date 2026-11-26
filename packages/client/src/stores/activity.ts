import { type AuditEvent, api, type ServerEvent, type SpaceUsage } from '@tiger/shared'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { toClientError } from '../api'
import { type ClientContext, failed, IDLE, LOADING, type Load, READY } from '../load'

/** Audit log and token usage of the current Space. */
export interface ActivityState {
  spaceId: string | null
  /** Newest first. */
  audit: AuditEvent[]
  auditLoad: Load
  usage: SpaceUsage | null
  usageLoad: Load
}

export interface ActivityController {
  store: StoreApi<ActivityState>
  load(spaceId: string | null): Promise<void>
  reload(): Promise<void>
  refreshUsage(): Promise<void>
  handleEvent(e: ServerEvent): void
  reset(): void
}

const AUDIT_LIMIT = 100

export function createActivity(ctx: ClientContext): ActivityController {
  const initial = (): ActivityState => ({
    spaceId: null,
    audit: [],
    auditLoad: IDLE,
    usage: null,
    usageLoad: IDLE,
  })
  const store = createStore<ActivityState>()(initial)

  async function loadAudit(spaceId: string) {
    store.setState({ auditLoad: LOADING })
    try {
      const audit = await ctx.api.call(api.listAudit, {
        params: { spaceId },
        query: { limit: AUDIT_LIMIT },
      })
      if (store.getState().spaceId === spaceId) store.setState({ audit, auditLoad: READY })
    } catch (e) {
      if (store.getState().spaceId === spaceId)
        store.setState({ auditLoad: failed(toClientError(e)) })
    }
  }

  async function loadUsage(spaceId: string) {
    store.setState({ usageLoad: LOADING })
    try {
      const usage = await ctx.api.call(api.getUsage, { params: { spaceId } })
      if (store.getState().spaceId === spaceId) store.setState({ usage, usageLoad: READY })
    } catch (e) {
      if (store.getState().spaceId === spaceId)
        store.setState({ usageLoad: failed(toClientError(e)) })
    }
  }

  const controller: ActivityController = {
    store,
    async load(spaceId) {
      store.setState({ ...initial(), spaceId }, true)
      if (!spaceId) return
      await Promise.all([loadAudit(spaceId), loadUsage(spaceId)])
    },
    reload() {
      return controller.load(store.getState().spaceId)
    },
    async refreshUsage() {
      const spaceId = store.getState().spaceId
      if (spaceId) await loadUsage(spaceId)
    },
    handleEvent(e) {
      if (e.type !== 'audit.appended') return
      const s = store.getState()
      if (e.event.spaceId !== s.spaceId || s.audit.some((a) => a.id === e.event.id)) return
      store.setState({ audit: [e.event, ...s.audit].slice(0, AUDIT_LIMIT) })
    },
    reset() {
      store.setState(initial(), true)
    },
  }
  return controller
}
