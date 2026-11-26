import { describe, expect, it } from 'vitest'
import { cleanMarkers, finalizeAnswer } from '../../src/chat/citations'
import { stripMarkers } from '../../src/chat/prompt'
import type { ContextSource } from '../../src/retrieval/context'

function source(n: number, text: string): ContextSource {
  return {
    n,
    itemId: `0190f000-0000-7000-8000-00000000000${n}`,
    itemVersionId: `0190f000-0000-7000-8000-00000000010${n}`,
    title: `Source ${n}`,
    url: `https://example.com/${n}`,
    sourceType: 'web',
    sharedBy: { id: '0190f000-0000-7000-8000-000000000900', name: 'Aki', avatarUrl: null },
    sharedAt: '2026-11-01T00:00:00.000Z',
    text,
  } as ContextSource
}

const one = new Set([1])
const none = new Set<string>()

describe('citation markers are not confused with URLs, indexes and prose', () => {
  it('leaves URLs, Markdown link targets and array indexes untouched', () => {
    for (const text of [
      'Call https://api.example.com/v1/items?ids[5]=a&ids[6]=b now.',
      'See [Link](https://example.com/page[7]) here.',
      'Compute x = data[12] first.',
      'Use arr[0] for the head.',
      'Read https://example.com/wiki/a[1] for more.',
    ]) {
      expect(cleanMarkers(text, one, none)).toBe(text)
    }
    const final = finalizeAnswer(
      'Read https://example.com/wiki/a[1] for more.',
      [source(1, 'Body.')],
      [],
    )
    expect(final.citations).toEqual([])
  })

  it('still treats markers after spaces, punctuation and Japanese text as markers', () => {
    expect(cleanMarkers('Revenue grew [1]. 売上は増えた[1]。End.[1]', one, none)).toBe(
      'Revenue grew [1]. 売上は増えた[1]。End.[1]',
    )
  })

  it('reads full-width digits, lenticular brackets and ranges as markers', () => {
    const sources = [source(1, 'One.'), source(2, 'Two.'), source(3, 'Three.')]
    const final = finalizeAnswer('A ［１］. B 【2】. C [1-3]. D [2–3].', sources, [])
    expect(final.content).toBe('A [1]. B [2]. C [1][2][3]. D [2][3].')
    expect(final.citations.map((c) => c.n)).toEqual([1, 2, 3])
  })

  it('stripMarkers keeps Markdown link text and URLs in history', () => {
    expect(stripMarkers('see [1](https://x.y) and https://e.com/a[2] and [3].')).toBe(
      'see [1](https://x.y) and https://e.com/a[2] and.',
    )
  })
})
