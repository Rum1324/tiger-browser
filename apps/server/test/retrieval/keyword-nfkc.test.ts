import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRetriever, keywordTerms } from '../../src/retrieval'
import { spaceWithMembers } from '../helpers/fixtures'
import type { Harness } from '../helpers/harness'
import { BlindEmbedder, share, startRetrievalHarness } from './helpers'

const signal = new AbortController().signal
let h: Harness
beforeAll(async () => {
  ;({ h } = await startRetrievalHarness(new BlindEmbedder()))
})
afterAll(() => h.close())

describe('keyword leg with full-width input', () => {
  it('opens the gate for identifiers typed in full-width through an IME', () => {
    expect(keywordTerms('ＥＲＲ－４０１２の原因')).toEqual(['ERR-4012'])
    expect(keywordTerms('ＫＰＩの定義')).toEqual(['KPI'])
    expect(keywordTerms('ERR-4012の原因')).toEqual(['ERR-4012'])
  })

  it('a full-width query finds half-width chunk text and the reverse', async () => {
    const { owner, space } = await spaceWithMembers(h, 'Nfkc')
    const filler = (n: number) => `# 資料${n}\n\n${'無関係な説明文です。'.repeat(5)}`
    for (let i = 0; i < 5; i++) {
      await share(h, owner.token, space.id, `https://example.com/f${i}`, `F${i}`, filler(i))
    }
    const half = await share(
      h,
      owner.token,
      space.id,
      'https://example.com/err',
      'Errors',
      '# エラー\n\nERR-4012 はトークンの期限切れで発生します。',
    )
    const full = await share(
      h,
      owner.token,
      space.id,
      'https://example.com/kpi',
      'KPI',
      '# 指標\n\nＫＰＩは四半期ごとに見直します。',
    )
    const retriever = createRetriever({ sql: h.sql, embedder: new BlindEmbedder() })
    const a = await retriever.search({
      spaceId: space.id,
      query: 'ＥＲＲ－４０１２の原因',
      k: 1,
      signal,
    })
    expect(a[0]?.itemId).toBe(half.id)
    const b = await retriever.search({ spaceId: space.id, query: 'KPIの定義', k: 1, signal })
    expect(b[0]?.itemId).toBe(full.id)
  })
})
