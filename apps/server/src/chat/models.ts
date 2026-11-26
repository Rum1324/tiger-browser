import { type Catalog, defaultCatalog, priceAt, type Router } from '@tiger/llm'
import type { ModelInfo, ModelRef } from '@tiger/shared'
import type { ModelDirectory } from '../seams'

const same = (a: ModelRef, b: ModelRef) => a.provider === b.provider && a.id === b.id

/**
 * The configured default when it is usable, otherwise the router's best-ranked available model
 * (which falls back to whichever provider has a key, and to the mock when only the mock is on).
 */
export function resolveDefaultModel(
  models: ModelInfo[],
  configured: ModelRef | null,
  routerDefault: ModelRef | null,
): ModelRef | null {
  if (configured && models.some((m) => m.available && same(m, configured))) return configured
  return routerDefault
}

/** The model catalog as the router sees it, with keys applied. */
export function createModelDirectory(deps: {
  router: Router
  defaultModel?: ModelRef | null
}): ModelDirectory {
  return {
    async list() {
      const models = deps.router.listModels()
      return {
        models,
        defaultModel: resolveDefaultModel(
          models,
          deps.defaultModel ?? null,
          deps.router.defaultModel(),
        ),
      }
    },
  }
}

/**
 * Cheapest available model at today's prices, for small chores like thread titles. Real providers
 * win over the mock, so a development server with a key and the mock on still gets real titles.
 */
export function cheapestModel(
  router: Router,
  catalog: Catalog = defaultCatalog,
  at: Date = new Date(),
): ModelRef | null {
  const available = router.listModels().filter((m) => m.available)
  const priced = available.flatMap((m) => {
    const entry = catalog.models.find((c) => same(c, m))
    if (!entry) return []
    const p = priceAt(entry, at)
    // A title request is mostly input; weight output the way a short exchange is billed.
    return [
      { ref: { provider: m.provider, id: m.id }, cost: p.inputPerMTok + p.outputPerMTok / 10 },
    ]
  })
  const real = priced.filter((m) => m.ref.provider !== 'mock')
  const pool = real.length > 0 ? real : priced
  pool.sort((a, b) => a.cost - b.cost || a.ref.id.localeCompare(b.ref.id))
  return pool[0]?.ref ?? null
}
