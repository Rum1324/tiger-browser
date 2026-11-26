import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createContextBuilder, renderContext } from '../../src/retrieval'
import { spaceWithMembers } from '../helpers/fixtures'
import type { Harness } from '../helpers/harness'
import { share, startRetrievalHarness } from './helpers'

let h: Harness
let retrieval: Awaited<ReturnType<typeof startRetrievalHarness>>['retrieval']
beforeAll(async () => {
  ;({ h, retrieval } = await startRetrievalHarness())
})
afterAll(() => h.close())

const builder = (
  wholeSpaceMaxTokens: number,
  extra: { k?: number; neighbourRadius?: number } = {},
) =>
  createContextBuilder({
    sql: h.sql,
    retriever: retrieval.retriever,
    options: { wholeSpaceMaxTokens, ...extra },
  })

describe('ContextBuilder', () => {
  it('returns an empty whole-space context for a Space with no items', async () => {
    const { space } = await spaceWithMembers(h, 'CtxEmpty')
    const ctx = await builder(10_000).build({ spaceId: space.id, question: 'anything' })
    expect(ctx).toEqual({
      mode: 'whole-space',
      sources: [],
      estimatedTokens: 0,
      spaceChars: 0,
      itemCount: 0,
    })
  })

  it('injects every current item whole, with provenance, when the Space is small', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'CtxSmall')
    const a = await share(
      h,
      owner.token,
      space.id,
      'https://example.com/a',
      'Alpha',
      '# Alpha\n\nfirst body.',
    )
    const b = await share(
      h,
      member.token,
      space.id,
      'https://example.com/b',
      'Beta',
      '# Beta\n\nsecond body.',
    )
    const ctx = await builder(10_000).build({ spaceId: space.id, question: 'unrelated question' })
    expect(ctx.mode).toBe('whole-space')
    expect(ctx.itemCount).toBe(2)
    expect(ctx.spaceChars).toBe('# Alpha\n\nfirst body.'.length + '# Beta\n\nsecond body.'.length)
    expect(ctx.sources.map((s) => s.n)).toEqual([1, 2])
    expect(ctx.sources[0]).toMatchObject({
      itemId: a.id,
      itemVersionId: a.currentVersion.id,
      title: 'Alpha',
      url: 'https://example.com/a',
      sourceType: 'web',
      sharedBy: { id: owner.user.id, name: owner.user.name },
      text: '# Alpha\n\nfirst body.',
    })
    expect(ctx.sources[1]).toMatchObject({
      itemId: b.id,
      sharedBy: { id: member.user.id },
      text: '# Beta\n\nsecond body.',
    })
    expect(new Date(ctx.sources[0]?.sharedAt ?? '').toISOString()).toBe(ctx.sources[0]?.sharedAt)
    expect(ctx.estimatedTokens).toBeGreaterThan(0)
  })

  it('keeps the rendered whole-space prefix byte-identical between questions and on append', async () => {
    const { owner, space } = await spaceWithMembers(h, 'CtxStable')
    for (const name of ['one', 'two', 'three', 'four']) {
      await share(
        h,
        owner.token,
        space.id,
        `https://example.com/${name}`,
        name,
        `# ${name}\n\nbody of ${name}.`,
      )
    }
    const cb = builder(10_000)
    const first = renderContext(await cb.build({ spaceId: space.id, question: 'what is one?' }))
    const second = renderContext(await cb.build({ spaceId: space.id, question: '全然違う質問' }))
    expect(second).toBe(first)

    // A new share goes to the end: everything before it is unchanged.
    await share(
      h,
      owner.token,
      space.id,
      'https://example.com/five',
      'five',
      '# five\n\nbody of five.',
    )
    const third = renderContext(await cb.build({ spaceId: space.id, question: 'what is one?' }))
    expect(third.startsWith(first)).toBe(true)
    expect(third.length).toBeGreaterThan(first.length)

    // A re-share of an existing item keeps its position.
    await share(
      h,
      owner.token,
      space.id,
      'https://example.com/two',
      'two',
      '# two\n\nrewritten body of two.',
    )
    const fourth = await cb.build({ spaceId: space.id, question: 'x' })
    expect(fourth.sources.map((s) => s.title)).toEqual(['one', 'two', 'three', 'four', 'five'])
    expect(fourth.sources[1]?.text).toContain('rewritten')
  })

  it('drops an unshared item from the context', async () => {
    const { owner, space } = await spaceWithMembers(h, 'CtxUnshare')
    const a = await share(h, owner.token, space.id, 'https://example.com/a', 'A', '# A\n\nkeep.')
    const b = await share(h, owner.token, space.id, 'https://example.com/b', 'B', '# B\n\ngone.')
    await h.ok('unshareItem', { params: { itemId: b.id } }, owner.token)
    const ctx = await builder(10_000).build({ spaceId: space.id, question: 'q' })
    expect(ctx.sources.map((s) => s.itemId)).toEqual([a.id])
    expect(renderContext(ctx)).not.toContain('gone')
  })

  it('switches to retrieval when the Space is over the configured size, and says so', async () => {
    const { owner, space } = await spaceWithMembers(h, 'CtxSwitch')
    await share(
      h,
      owner.token,
      space.id,
      'https://example.com/fruit',
      'Fruit',
      '# Fruit\n\nApples and pears grow in orchards.',
    )
    await share(
      h,
      owner.token,
      space.id,
      'https://example.com/tools',
      'Tools',
      '# Tools\n\nHammers and wrenches live in the garage.',
    )
    const whole = await builder(100_000).build({
      spaceId: space.id,
      question: 'garage hammers wrenches',
    })
    expect(whole.mode).toBe('whole-space')
    const wholeTokens = whole.estimatedTokens

    const retrieved = await builder(10, { k: 1, neighbourRadius: 0 }).build({
      spaceId: space.id,
      question: 'garage hammers wrenches',
    })
    expect(retrieved.mode).toBe('retrieval')
    expect(retrieved.sources).toHaveLength(1)
    expect(retrieved.sources[0]).toMatchObject({
      n: 1,
      title: 'Tools',
      sharedBy: { id: owner.user.id },
    })
    expect(retrieved.sources[0]?.text).toContain('Hammers and wrenches')
    expect(retrieved.estimatedTokens).toBeLessThan(wholeTokens)
    expect(retrieved.itemCount).toBe(2)
    expect(retrieved.spaceChars).toBe(whole.spaceChars)
  })

  it('switches exactly at the threshold', async () => {
    const { owner, space } = await spaceWithMembers(h, 'CtxEdge')
    await share(h, owner.token, space.id, 'https://example.com/e', 'E', '# E\n\nsome text here.')
    const tokens = (await builder(1_000_000).build({ spaceId: space.id, question: 'q' }))
      .estimatedTokens
    expect((await builder(tokens).build({ spaceId: space.id, question: 'q' })).mode).toBe(
      'whole-space',
    )
    expect((await builder(tokens - 1).build({ spaceId: space.id, question: 'q' })).mode).toBe(
      'retrieval',
    )
  })

  it('merges neighbouring chunks into passages and groups hits by item', async () => {
    const { owner, space } = await spaceWithMembers(h, 'CtxMerge')
    const sections = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel']
    const md = sections.map((s) => `## ${s}\n\nThe ${s} section talks about ${s}.`).join('\n\n')
    const doc = await share(h, owner.token, space.id, 'https://example.com/doc', 'Doc', md)
    await share(
      h,
      owner.token,
      space.id,
      'https://example.com/other',
      'Other',
      '# Other\n\nnothing relevant here at all.',
    )
    const cb = builder(1, { k: 2, neighbourRadius: 1 })

    // Adjacent hits (charlie, delta) with radius 1 become one passage bravo..echo.
    const adjacent = await cb.build({ spaceId: space.id, question: 'charlie delta' })
    expect(adjacent.mode).toBe('retrieval')
    const src = adjacent.sources.find((s) => s.itemId === doc.id)
    expect(src?.passages).toHaveLength(1)
    const text = src?.passages[0]?.text ?? ''
    for (const s of ['bravo', 'charlie', 'delta', 'echo'])
      expect(text).toContain(`The ${s} section`)
    for (const s of ['alpha', 'foxtrot', 'golf', 'hotel'])
      expect(text).not.toContain(`The ${s} section`)
    expect(src?.passages[0]?.headingPath).toBe('bravo')
    expect(adjacent.sources.filter((s) => s.itemId === doc.id)).toHaveLength(1)

    // Distant hits stay separate passages of the same source, with a gap marker between them.
    const distant = await cb.build({ spaceId: space.id, question: 'alpha hotel' })
    const dsrc = distant.sources.find((s) => s.itemId === doc.id)
    expect(dsrc?.passages.length).toBe(2)
    expect(dsrc?.text).toContain('\n…\n')
  })

  it('numbers retrieval sources by the rank of their best chunk and renders them deterministically', async () => {
    const { owner, space } = await spaceWithMembers(h, 'CtxRank')
    await share(
      h,
      owner.token,
      space.id,
      'https://example.com/x',
      'X',
      '# X\n\nkiwi kiwi kiwi fruit.',
    )
    await share(
      h,
      owner.token,
      space.id,
      'https://example.com/y',
      'Y',
      '# Y\n\nbanana banana banana fruit.',
    )
    const cb = builder(1, { k: 2, neighbourRadius: 0 })
    const ctx = await cb.build({ spaceId: space.id, question: 'banana banana banana' })
    expect(ctx.sources.map((s) => [s.n, s.title])).toEqual([
      [1, 'Y'],
      [2, 'X'],
    ])
    const again = await cb.build({ spaceId: space.id, question: 'banana banana banana' })
    expect(renderContext(again)).toBe(renderContext(ctx))
    expect(renderContext(ctx)).toContain('[1] Y\nURL: https://example.com/y\nType: web; shared by')
  })

  it('never includes another Space in either mode', async () => {
    const a = await spaceWithMembers(h, 'CtxIsoA')
    const b = await spaceWithMembers(h, 'CtxIsoB')
    await share(
      h,
      a.owner.token,
      a.space.id,
      'https://example.com/s',
      'Secret A',
      '# S\n\nthe vault code is 7421.',
    )
    await share(
      h,
      b.owner.token,
      b.space.id,
      'https://example.com/p',
      'Public B',
      '# P\n\nlunch menu today.',
    )
    for (const max of [100_000, 1]) {
      const ctx = await builder(max).build({ spaceId: b.space.id, question: 'vault code 7421' })
      expect(renderContext(ctx)).not.toContain('7421')
      expect(ctx.sources.every((s) => s.title === 'Public B')).toBe(true)
    }
  })
})
