import { describe, expect, it } from 'vitest'
import { createRouter } from '../src/router'
import type { ChatEvent } from '../src/types'
import { collect, text } from './helpers'

const key = process.env.ANTHROPIC_API_KEY
const model = { provider: 'anthropic', id: 'claude-haiku-5-5' } as const

/** About 5k tokens of numbered sources, unique per run so the first call is a true cache write. */
function buildContext(nonce: string): string {
  const parts = [`Shared context ${nonce}. Cite sources with [n].`]
  for (let n = 1; n <= 40; n++) {
    parts.push(
      `[${n}] Meeting notes ${n} https://example.com/notes/${n}\n` +
        `On day ${n} the team agreed that the launch checklist item ${n} is owned by member ${n % 7}. ` +
        `The decision record for item ${n} mentions budget code ${nonce}-${n}, a review on week ${n % 12}, ` +
        `and a fallback plan that keeps the previous release available for customers during rollout.`,
    )
  }
  return parts.join('\n\n')
}

describe.skipIf(!key)('Anthropic live (claude-haiku-5-5)', () => {
  const router = createRouter({ anthropicKey: key })
  const nonce = `n${Date.now()}${Math.floor(Math.random() * 1e6)}`
  const context = buildContext(nonce)
  let spent = 0

  const ask = async (q: string, over = {}) => {
    const ev = await collect(
      router.stream({
        model,
        system: 'Answer in one short sentence using the numbered sources. Cite as [n].',
        context,
        messages: [{ role: 'user', content: q }],
        maxOutputTokens: 200,
        cacheKey: 'space-live',
        ...over,
      }),
    )
    const usage = ev.find((e): e is Extract<ChatEvent, { type: 'usage' }> => e.type === 'usage')
    if (usage) spent += usage.inputTokens + usage.outputTokens
    return { ev, usage }
  }

  it('streams text in several deltas and writes the cache on the first call', async () => {
    const { ev, usage } = await ask('Who owns checklist item 3?')
    expect(ev.filter((e) => e.type === 'text').length).toBeGreaterThan(1)
    expect(text(ev).length).toBeGreaterThan(5)
    expect(ev.at(-1)).toEqual({ type: 'done', stopReason: 'end' })
    expect(usage?.cacheWriteTokens).toBeGreaterThan(512)
    expect(usage?.cachedInputTokens).toBe(0)
    expect(usage?.inputTokens).toBeGreaterThanOrEqual(usage?.cacheWriteTokens ?? 0)
    console.log('live call 1', JSON.stringify(usage))
  })

  it('reads the cache on the second call', async () => {
    const { usage, ev } = await ask('Which review week applies to item 5?')
    expect(text(ev).length).toBeGreaterThan(5)
    expect(usage?.cachedInputTokens).toBeGreaterThan(512)
    expect(usage?.cacheWriteTokens).toBe(0)
    console.log('live call 2', JSON.stringify(usage))
    const cost = router.costUsd(model, usage as never, new Date())
    expect(cost).toBeGreaterThan(0)
  })

  it('returns text, not an empty thinking-only reply, with a tiny max output', async () => {
    const { ev } = await ask('Say hello.', { context: undefined, maxOutputTokens: 50 })
    expect(text(ev).trim().length).toBeGreaterThan(0)
    expect(ev.at(-1)).toMatchObject({ type: 'done' })
  })

  it('stays under the input budget', () => {
    console.log('live total tokens (input+output)', spent)
    expect(spent).toBeLessThan(60_000)
  })
})
