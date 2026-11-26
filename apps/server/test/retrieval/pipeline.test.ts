import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newId } from '../../src/ids'
import { type Embedder, keywordTerms } from '../../src/retrieval'
import { spaceWithMembers } from '../helpers/fixtures'
import type { Harness } from '../helpers/harness'
import { BlindEmbedder, share, startRetrievalHarness } from './helpers'

const signal = new AbortController().signal
let h: Harness
let retrieval: Awaited<ReturnType<typeof startRetrievalHarness>>['retrieval']

beforeAll(async () => {
  ;({ h, retrieval } = await startRetrievalHarness())
})
afterAll(() => h.close())

const JA_DOC = [
  '# 資金調達',
  '',
  '## シリーズA',
  '',
  '2026年9月にシリーズAの資金調達を完了した。リード投資家は国内VCで、調達額は総額8億円である。',
  '',
  '## 採用計画',
  '',
  'エンジニアを十名採用する。採用担当は人事部の佐藤さんが務める。',
].join('\n')
const EN_DOC = [
  '# Onboarding handbook',
  '',
  '## Laptop setup',
  '',
  'New hires receive a laptop on the first day. Install the VPN client before anything else.',
  '',
  '## Expense policy',
  '',
  'Submit receipts within thirty days. Travel needs manager approval in advance.',
].join('\n')

async function chunkRows(itemId: string) {
  return h.sql<{ ord: number; heading_path: string; text: string; item_version_id: string }[]>`
    select ord, heading_path, text, item_version_id from chunks where item_id = ${itemId} order by ord
  `
}

describe('indexer + retriever', () => {
  it('indexes an item and finds it in Japanese and in English', async () => {
    const { owner, space } = await spaceWithMembers(h, 'Find')
    const ja = await share(h, owner.token, space.id, 'https://example.com/fund', 'ファンド', JA_DOC)
    const en = await share(h, owner.token, space.id, 'https://example.com/hb', 'Handbook', EN_DOC)
    expect(ja.status).toBe('ready')
    const stored = await chunkRows(ja.id)
    expect(stored.map((c) => c.heading_path)).toEqual([
      '資金調達 > シリーズA',
      '資金調達 > 採用計画',
    ])
    expect(stored.every((c) => c.item_version_id === ja.currentVersion.id)).toBe(true)

    const jaHits = await retrieval.retriever.search({
      spaceId: space.id,
      query: '資金調達の調達額はいくら',
      k: 3,
      signal,
    })
    expect(jaHits[0]).toMatchObject({ itemId: ja.id, headingPath: '資金調達 > シリーズA' })
    expect(jaHits[0]?.text).toContain('8億円')

    const enHits = await retrieval.retriever.search({
      spaceId: space.id,
      query: 'receipts submit within days expense policy',
      k: 3,
      signal,
    })
    expect(enHits[0]).toMatchObject({
      itemId: en.id,
      headingPath: 'Onboarding handbook > Expense policy',
    })
    // Scores come back in descending order.
    expect(enHits.map((x) => x.score)).toEqual(
      [...enHits.map((x) => x.score)].sort((a, b) => b - a),
    )
  })

  it('serves POST /search through the retriever', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'Route')
    const item = await share(h, owner.token, space.id, 'https://example.com/r', 'Handbook', EN_DOC)
    const hits = await h.ok(
      'search',
      { params: { spaceId: space.id }, body: { query: 'laptop on the first day', k: 2 } },
      member.token,
    )
    expect(hits[0]).toMatchObject({ itemId: item.id, itemVersionId: item.currentVersion.id })
    expect(hits[0]?.chunkId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('replaces the chunks on a re-share and leaves nothing of the old version', async () => {
    const { owner, space } = await spaceWithMembers(h, 'Reshare')
    const url = 'https://example.com/doc'
    const v1 = await share(
      h,
      owner.token,
      space.id,
      url,
      'Doc',
      '# Doc\n\nAlpha zebra quartz marker.',
    )
    const before = await chunkRows(v1.id)
    expect(before).toHaveLength(1)

    const v2 = await share(
      h,
      owner.token,
      space.id,
      url,
      'Doc',
      '# Doc\n\n## Part one\n\nBeta falcon marker text.\n\n## Part two\n\nGamma harbour marker text.',
    )
    expect(v2.id).toBe(v1.id)
    expect(v2.currentVersion.number).toBe(2)
    const after = await chunkRows(v1.id)
    expect(after.map((c) => c.heading_path)).toEqual(['Doc > Part one', 'Doc > Part two'])
    expect(after.every((c) => c.item_version_id === v2.currentVersion.id)).toBe(true)
    const counted = await h.sql<
      { n: string }[]
    >`select count(*) as n from chunks where item_id = ${v1.id}`
    expect(Number(counted[0]?.n)).toBe(2)

    const old = await retrieval.retriever.search({
      spaceId: space.id,
      query: 'zebra quartz',
      k: 5,
      signal,
    })
    expect(old.some((x) => x.text.includes('zebra'))).toBe(false)
  })

  it('ignores a slow run for a version that is no longer current', async () => {
    const { owner, space } = await spaceWithMembers(h, 'Stale')
    const url = 'https://example.com/stale'
    const v1 = await share(h, owner.token, space.id, url, 'Stale', '# S\n\nold content one.')
    const oldVersionId = v1.currentVersion.id
    const v2 = await share(h, owner.token, space.id, url, 'Stale', '# S\n\nnew content two.')
    await retrieval.indexer.index({
      spaceId: space.id,
      itemId: v1.id,
      itemVersionId: oldVersionId,
      url,
      title: 'Stale',
      sourceType: 'web',
      markdown: '# S\n\nold content one.',
      lang: 'en',
      signal,
    })
    const rows = await chunkRows(v1.id)
    expect(rows.map((r) => r.text)).toEqual(['new content two.'])
    expect(rows[0]?.item_version_id).toBe(v2.currentVersion.id)
  })

  it('keeps the previous chunks and fails the item when embedding throws', async () => {
    const { owner, space } = await spaceWithMembers(h, 'Crash')
    const item = await share(
      h,
      owner.token,
      space.id,
      'https://example.com/c',
      'C',
      '# C\n\nkept text.',
    )
    const failing: Embedder = {
      id: 'failing',
      embedPassages: async () => {
        throw new Error('model crashed')
      },
      embedQueries: async () => [],
    }
    const { createIndexer } = await import('../../src/retrieval')
    await expect(
      createIndexer({ sql: h.sql, embedder: failing }).index({
        spaceId: space.id,
        itemId: item.id,
        itemVersionId: item.currentVersion.id,
        url: item.url,
        title: 'C',
        sourceType: 'web',
        markdown: '# C\n\nbrand new text.',
        lang: null,
        signal,
      }),
    ).rejects.toThrow('model crashed')
    expect((await chunkRows(item.id)).map((r) => r.text)).toEqual(['kept text.'])
  })

  it('marks the item failed through the server when the embedder breaks', async () => {
    const failing: Embedder = {
      id: 'failing',
      embedPassages: async () => {
        throw new Error('boom')
      },
      embedQueries: async () => [],
    }
    const { h: h2 } = await startRetrievalHarness(failing)
    try {
      const { owner, space } = await spaceWithMembers(h2, 'Fail')
      const item = await share(
        h2,
        owner.token,
        space.id,
        'https://example.com/f',
        'F',
        '# F\n\ntext.',
      )
      expect(item.status).toBe('failed')
    } finally {
      await h2.close()
    }
  })

  it('leaves no chunk after unshare', async () => {
    const { owner, space } = await spaceWithMembers(h, 'Unshare')
    const item = await share(h, owner.token, space.id, 'https://example.com/u', 'U', JA_DOC)
    expect((await chunkRows(item.id)).length).toBeGreaterThan(0)
    await h.ok('unshareItem', { params: { itemId: item.id } }, owner.token)
    expect(await chunkRows(item.id)).toHaveLength(0)
    const counted = await h.sql<
      { n: string }[]
    >`select count(*) as n from chunks where space_id = ${space.id}`
    expect(Number(counted[0]?.n)).toBe(0)
    const hits = await retrieval.retriever.search({
      spaceId: space.id,
      query: 'シリーズA',
      k: 5,
      signal,
    })
    expect(hits).toEqual([])
  })

  it('never returns another Space chunks, even for identical content', async () => {
    const a = await spaceWithMembers(h, 'IsoA')
    const b = await spaceWithMembers(h, 'IsoB')
    const secret = '# Plan\n\nThe codename is Bluebird Orchid and the launch is in March.'
    const inA = await share(
      h,
      a.owner.token,
      a.space.id,
      'https://example.com/plan',
      'Plan A',
      secret,
    )
    const inB = await share(
      h,
      b.owner.token,
      b.space.id,
      'https://example.com/plan',
      'Plan B',
      secret,
    )
    expect(inA.id).not.toBe(inB.id)

    for (const kw of ['codename Bluebird Orchid', '"Bluebird Orchid"', 'Orchid']) {
      const fromA = await retrieval.retriever.search({
        spaceId: a.space.id,
        query: kw,
        k: 10,
        signal,
      })
      const fromB = await retrieval.retriever.search({
        spaceId: b.space.id,
        query: kw,
        k: 10,
        signal,
      })
      expect(fromA.length).toBeGreaterThan(0)
      expect(fromB.length).toBeGreaterThan(0)
      expect(fromA.every((x) => x.itemId === inA.id)).toBe(true)
      expect(fromB.every((x) => x.itemId === inB.id)).toBe(true)
    }
    // A Space with nothing in it finds nothing, whatever it asks.
    const empty = await spaceWithMembers(h, 'IsoEmpty')
    expect(
      await retrieval.retriever.search({
        spaceId: empty.space.id,
        query: 'Bluebird Orchid',
        k: 10,
        signal,
      }),
    ).toEqual([])
    // And a Space id that does not exist.
    expect(
      await retrieval.retriever.search({
        spaceId: newId(),
        query: 'Bluebird Orchid',
        k: 10,
        signal,
      }),
    ).toEqual([])
  })

  it('does not run the HNSW query across Spaces: every chunk of A is absent from B results', async () => {
    const a = await spaceWithMembers(h, 'CrossA')
    const b = await spaceWithMembers(h, 'CrossB')
    for (let i = 0; i < 6; i++) {
      await share(
        h,
        a.owner.token,
        a.space.id,
        `https://example.com/a${i}`,
        `A${i}`,
        `# A${i}\n\ntopic apples ${i} orchard.`,
      )
    }
    await share(
      h,
      b.owner.token,
      b.space.id,
      'https://example.com/b',
      'B',
      '# B\n\ntopic apples orchard.',
    )
    const hits = await retrieval.retriever.search({
      spaceId: b.space.id,
      query: 'topic apples orchard',
      k: 20,
      signal,
    })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.title).toBe('B')
  })
})

describe('exact-token gate', () => {
  it('opens for quoted phrases, identifiers and short terms, and stays shut for questions', () => {
    expect(keywordTerms('"annual leave" policy')).toEqual(['annual leave'])
    expect(keywordTerms('「稟議書」の書き方')).toEqual(['稟議書'])
    expect(keywordTerms('what does ERR-4012 mean')).toEqual(['ERR-4012'])
    expect(keywordTerms('upgrade to v2.3.1 soon')).toEqual(['v2.3.1'])
    expect(keywordTerms('check the user_id column')).toEqual(['user_id'])
    expect(keywordTerms('define KPI')).toEqual(['KPI'])
    expect(keywordTerms('稟議')).toEqual(['稟議'])
    expect(keywordTerms('SAFE')).toEqual(['SAFE'])
    expect(keywordTerms('how do I request time off')).toEqual([])
    expect(keywordTerms('資金調達のリード投資家は誰ですか')).toEqual([])
    expect(keywordTerms('Series A round')).toEqual([])
    expect(keywordTerms('   ')).toEqual([])
  })

  it('a keyword leg finds an exact identifier the vector leg cannot see, only when the gate opens', async () => {
    const { h: hb, retrieval: rb } = await startRetrievalHarness(new BlindEmbedder())
    try {
      const { owner, space } = await spaceWithMembers(hb, 'Gate')
      for (let i = 0; i < 6; i++) {
        await share(
          hb,
          owner.token,
          space.id,
          `https://example.com/n${i}`,
          `Note ${i}`,
          `# N${i}\n\nGeneral note number ${i} about meetings.`,
        )
      }
      const target = await share(
        hb,
        owner.token,
        space.id,
        'https://example.com/err',
        'Errors',
        '# Errors\n\nCode ERR-4012 means the token expired. Refresh it.',
      )
      // Vector scores tie everywhere, so rank 1 can only come from the keyword leg.
      const gated = await rb.retriever.search({
        spaceId: space.id,
        query: 'ERR-4012',
        k: 3,
        signal,
      })
      expect(gated[0]?.itemId).toBe(target.id)
      // The same word as plain text carries no signal, so the target is left at the tie-break order.
      const plain = await rb.retriever.search({
        spaceId: space.id,
        query: 'which token expired',
        k: 3,
        signal,
      })
      expect(plain.map((x) => x.itemId)).not.toContain(target.id)
      // A quoted plain phrase opens the gate too.
      const quoted = await rb.retriever.search({
        spaceId: space.id,
        query: '"token expired"',
        k: 3,
        signal,
      })
      expect(quoted[0]?.itemId).toBe(target.id)
    } finally {
      await hb.close()
    }
  })

  it('escapes LIKE wildcards in keyword terms', async () => {
    const { h: hb, retrieval: rb } = await startRetrievalHarness(new BlindEmbedder())
    try {
      const { owner, space } = await spaceWithMembers(hb, 'Like')
      await share(
        hb,
        owner.token,
        space.id,
        'https://example.com/x',
        'X',
        '# X\n\nplain words only here.',
      )
      const target = await share(
        hb,
        owner.token,
        space.id,
        'https://example.com/y',
        'Y',
        '# Y\n\ndiscount is 50% off today.',
      )
      const x = (await rb.retriever.search({ spaceId: space.id, query: 'zzz', k: 1, signal }))[0]
      // The tie order puts X first; only a real keyword match can lift Y above it.
      const hits = await rb.retriever.search({ spaceId: space.id, query: '"50%"', k: 2, signal })
      expect(hits.map((hit) => hit.itemId)).toEqual([target.id, x?.itemId])
      // "_" must not act as a wildcard: "disc_unt" does not match "discount", so no boost for Y.
      const flat = await rb.retriever.search({
        spaceId: space.id,
        query: '"disc_unt"',
        k: 2,
        signal,
      })
      expect(flat.map((hit) => hit.itemId)).toEqual([x?.itemId, target.id])
    } finally {
      await hb.close()
    }
  })
})
