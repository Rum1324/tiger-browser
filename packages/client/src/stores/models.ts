import { api, type ModelInfo, type ModelRef, type Provider } from '@tiger/shared'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { toClientError } from '../api'
import { type ClientContext, failed, IDLE, LOADING, type Load, READY } from '../load'

/**
 * The company that receives the content when a model is used. Company names are not translated;
 * the mock is a local test provider and sends nothing to any company.
 */
export const PROVIDER_COMPANY: Record<Provider, string | null> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  mock: null,
}

export interface ModelsState {
  models: ModelInfo[]
  /** The server's default (null when no provider is configured). */
  serverDefault: ModelRef | null
  /** The member's default, persisted in engine settings. */
  memberDefault: ModelRef | null
  /** The model the next message will use. Resets to the default after each AI message. */
  selected: ModelRef | null
  load: Load
}

export interface SelectedModel {
  model: ModelInfo
  provider: Provider
  /** Who receives the content; null for the local mock. */
  company: string | null
}

export interface ModelsController {
  store: StoreApi<ModelsState>
  load(): Promise<void>
  /** Choose the model for the next message only. */
  select(ref: ModelRef): void
  /** Persist a default for every future message (engine settings). */
  setDefault(ref: ModelRef | null): Promise<void>
  /** The next message's model with its provider, so the UI can say which company receives it. */
  selectedInfo(): SelectedModel | null
  /** Called after an AI message is posted: the per-message choice is used up. */
  consumeSelection(): void
  reset(): void
}

const same = (a: ModelRef | null, b: ModelRef | null) =>
  !!a && !!b && a.provider === b.provider && a.id === b.id

export function createModels(ctx: ClientContext): ModelsController {
  const initial = (): ModelsState => ({
    models: [],
    serverDefault: null,
    memberDefault: null,
    selected: null,
    load: IDLE,
  })
  const store = createStore<ModelsState>()(initial)

  const available = (ref: ModelRef | null): ModelRef | null => {
    if (!ref) return null
    const m = store.getState().models.find((x) => same(x, ref))
    return m?.available ? { provider: m.provider, id: m.id } : null
  }
  const effectiveDefault = (): ModelRef | null => {
    const s = store.getState()
    const first = s.models.find((m) => m.available)
    return (
      available(s.memberDefault) ??
      available(s.serverDefault) ??
      (first ? { provider: first.provider, id: first.id } : null)
    )
  }

  const controller: ModelsController = {
    store,
    async load() {
      store.setState({ load: LOADING })
      try {
        const [r, settings] = await Promise.all([
          ctx.api.call(api.listModels, {}),
          ctx.bridge.invoke('settings.get'),
        ])
        const stored = settings.defaultModel
        const memberDefault =
          stored && r.models.some((m) => m.provider === stored.provider && m.id === stored.id)
            ? (r.models.find((m) => m.provider === stored.provider && m.id === stored.id) ?? null)
            : null
        store.setState({
          models: r.models,
          serverDefault: r.defaultModel,
          memberDefault: memberDefault
            ? { provider: memberDefault.provider, id: memberDefault.id }
            : null,
          load: READY,
        })
        store.setState({ selected: effectiveDefault() })
      } catch (e) {
        store.setState({ load: failed(toClientError(e)) })
      }
    },
    select(ref) {
      const ok = available(ref)
      if (ok) store.setState({ selected: ok })
    },
    async setDefault(ref) {
      const chosen = ref ? available(ref) : null
      if (ref && !chosen) return
      await ctx.bridge.invoke('settings.update', { defaultModel: chosen })
      store.setState({ memberDefault: chosen })
      store.setState({ selected: effectiveDefault() })
    },
    selectedInfo() {
      const s = store.getState()
      const model = s.models.find((m) => same(m, s.selected))
      if (!model) return null
      return { model, provider: model.provider, company: PROVIDER_COMPANY[model.provider] }
    },
    consumeSelection() {
      store.setState({ selected: effectiveDefault() })
    },
    reset() {
      store.setState(initial(), true)
    },
  }
  return controller
}
