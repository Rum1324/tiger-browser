import { PROVIDER_COMPANY } from '@tiger/client'
import type { ModelInfo, ModelRef } from '@tiger/shared'
import { useMemo } from 'react'
import { useServices } from '../app/context'
import { shallow, useStore } from '../lib/store'

export interface ModelOption {
  model: ModelInfo
  /** The company the question (and any attached page) is sent to; null for the local mock. */
  company: string | null
  selected: boolean
  isDefault: boolean
}

export interface ModelsView {
  /** Grouped by tier, best first; unavailable models stay listed (disabled). */
  groups: { tier: ModelInfo['tier']; options: ModelOption[] }[]
  selected: ModelOption | null
  /** The member's default (Settings) or the server's. */
  defaultRef: ModelRef | null
  loading: boolean
  unavailable: boolean
  /** Choose the model for the next question only. */
  select(ref: ModelRef): void
  setDefault(ref: ModelRef | null): Promise<void>
}

const TIERS: ModelInfo['tier'][] = ['best', 'balanced', 'fast']
const same = (a: ModelRef | null, b: ModelRef | null) =>
  !!a && !!b && a.provider === b.provider && a.id === b.id

export function useModels(): ModelsView {
  const { client } = useServices()
  const s = useStore(client.models.store, (x) => x, shallow)
  return useMemo(() => {
    const defaultRef = s.memberDefault ?? s.serverDefault
    const option = (model: ModelInfo): ModelOption => ({
      model,
      company: PROVIDER_COMPANY[model.provider],
      selected: same(model, s.selected),
      isDefault: same(model, defaultRef),
    })
    const options = s.models.map(option)
    return {
      groups: TIERS.map((tier) => ({ tier, options: options.filter((o) => o.model.tier === tier) })).filter(
        (g) => g.options.length > 0,
      ),
      selected: options.find((o) => o.selected) ?? null,
      defaultRef,
      loading: s.load.status === 'loading',
      unavailable: s.load.status === 'ready' && !s.models.some((m) => m.available),
      select: (ref) => client.models.select(ref),
      setDefault: (ref) => client.models.setDefault(ref),
    }
  }, [s, client])
}
