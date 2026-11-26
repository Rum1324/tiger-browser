import { describe, expect, it } from 'vitest'
import {
  computeCostUsd,
  defaultCatalog,
  findModel,
  parseCatalog,
  priceAt,
  resolveMaxOutputTokens,
} from '../src/catalog'

const model = (provider: string, id: string) => {
  const m = findModel(defaultCatalog, { provider, id })
  if (!m) throw new Error(`missing ${id}`)
  return m
}

describe('catalog data', () => {
  it('parses the bundled file and has every provider', () => {
    const providers = new Set(defaultCatalog.models.map((m) => m.provider))
    expect([...providers].sort()).toEqual(['anthropic', 'google', 'mock', 'openai'])
  })

  it('flags only models actually called as verified', () => {
    for (const m of defaultCatalog.models) {
      if (m.provider === 'openai' || m.provider === 'google') expect(m.verified).toBe(false)
    }
    expect(model('anthropic', 'claude-haiku-5-5').verified).toBe(true)
  })

  it('rejects duplicate models and malformed rows', () => {
    const m = defaultCatalog.models[0]
    expect(() => parseCatalog({ updatedOn: '2026-11-26', models: [m, m] })).toThrow(/Duplicate/)
    expect(() => parseCatalog({ updatedOn: 'yesterday', models: [m] })).toThrow()
  })
})

describe('price selection by date', () => {
  const carbon = model('google', 'gemini-4-carbon')

  it('uses the row in force on the day, switching on the effective date', () => {
    expect(priceAt(carbon, '2026-11-30').inputPerMTok).toBe(2)
    expect(priceAt(carbon, '2026-12-01').inputPerMTok).toBe(4)
    expect(priceAt(carbon, new Date('2027-03-01T12:00:00Z')).outputPerMTok).toBe(20)
  })

  it('falls back to the earliest known row for older dates', () => {
    expect(priceAt(carbon, '2020-01-01').inputPerMTok).toBe(2)
  })

  it('sorts rows given out of order', () => {
    const base = defaultCatalog.models[0]
    if (!base) throw new Error('empty')
    const [row] = base.prices
    const cat = parseCatalog({
      updatedOn: '2026-11-26',
      models: [
        {
          ...base,
          prices: [
            { ...row, effectiveFrom: '2026-12-01', inputPerMTok: 9 },
            { ...row, effectiveFrom: '2026-01-01', inputPerMTok: 1 },
          ],
        },
      ],
    })
    const m = cat.models[0]
    if (!m) throw new Error('empty')
    expect(priceAt(m, '2026-06-01').inputPerMTok).toBe(1)
    expect(priceAt(m, '2026-12-02').inputPerMTok).toBe(9)
  })
})

describe('costUsd', () => {
  it('prices fresh, cached and cache-written input and output separately', () => {
    // Sonnet 5.5: $2 in, $10 out, read 0.05x, write 1.25x. 1M of each part.
    const usd = computeCostUsd(
      model('anthropic', 'claude-sonnet-5-5'),
      {
        inputTokens: 3_000_000,
        cachedInputTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
        outputTokens: 1_000_000,
      },
      '2026-11-26',
    )
    expect(usd).toBeCloseTo(2 + 0.1 + 2.5 + 10, 6)
  })

  it('applies the long-prompt rates to the whole request above the threshold', () => {
    const haiku = model('anthropic', 'claude-haiku-5-5')
    const usage = (inputTokens: number) => ({
      inputTokens,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000,
    })
    expect(computeCostUsd(haiku, usage(100_000), '2026-11-26')).toBeCloseTo(0.01 + 0.5, 6)
    expect(computeCostUsd(haiku, usage(100_001), '2026-11-26')).toBeCloseTo(0.050001 + 2.5, 5)
  })

  it('follows a scheduled price change', () => {
    const usage = {
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    }
    const carbon = model('google', 'gemini-4-carbon')
    expect(computeCostUsd(carbon, usage, '2026-11-30')).toBeCloseTo(2, 6)
    expect(computeCostUsd(carbon, usage, '2026-12-01')).toBeCloseTo(4, 6)
  })

  it('costs the mock at zero', () => {
    const usage = { inputTokens: 5, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 5 }
    expect(computeCostUsd(model('mock', 'mock-chat'), usage, '2026-11-26')).toBe(0)
  })
})

describe('resolveMaxOutputTokens', () => {
  it('floors a small request for reasoning models so thinking cannot eat the answer', () => {
    expect(resolveMaxOutputTokens(model('anthropic', 'claude-opus-5-5'), 50)).toBe(4096)
  })
  it('keeps the request when thinking is off', () => {
    expect(resolveMaxOutputTokens(model('anthropic', 'claude-haiku-5-5'), 50)).toBe(50)
  })
  it('uses the default and caps at the model maximum', () => {
    const haiku = model('anthropic', 'claude-haiku-5-5')
    expect(resolveMaxOutputTokens(haiku, undefined)).toBe(4096)
    expect(resolveMaxOutputTokens(haiku, 10_000_000)).toBe(128000)
  })
})
