import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Indexer } from '../src/seams'
import { spaceWithMembers } from './helpers/fixtures'
import { type Harness, page, startHarness } from './helpers/harness'

const noopIndexer: Indexer = { async index() {} }

let h: Harness
beforeAll(async () => {
  h = await startHarness({ indexer: noopIndexer })
})
afterAll(() => h.close())

describe('concurrent shares of one page', () => {
  it('concurrent reshares with different content all succeed with distinct version numbers', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'Reshare')
    const url = 'https://example.com/popular'
    await h.ok(
      'shareItem',
      { params: { spaceId: space.id }, body: { page: page(url, '# v1') } },
      owner.token,
    )
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        h.call(
          'shareItem',
          { params: { spaceId: space.id }, body: { page: page(url, `# change ${i}`) } },
          i % 2 ? owner.token : member.token,
        ),
      ),
    )
    expect(results.map((r) => r.status)).toEqual(results.map(() => 200))
    const numbers = await h.sql<{ number: number }[]>`
      select v.number from item_versions v join items i on i.id = v.item_id
      where i.space_id = ${space.id} order by v.number
    `
    expect(numbers.map((r) => r.number)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1))
  })

  it('concurrent first shares of a new URL create one item and never fail', async () => {
    const { owner, space } = await spaceWithMembers(h, 'FirstShare')
    const url = 'https://example.com/fresh'
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        h.call(
          'shareItem',
          { params: { spaceId: space.id }, body: { page: page(url, `# first ${i}`) } },
          owner.token,
        ),
      ),
    )
    expect(results.map((r) => r.status)).toEqual(results.map(() => 200))
    const outcomes = results.map((r) =>
      r.status === 200 && 'outcome' in r.body ? r.body.outcome : null,
    )
    expect(outcomes.filter((o) => o === 'new')).toHaveLength(1)
    const [count] = await h.sql<
      { n: number }[]
    >`select count(*)::int as n from items where space_id = ${space.id}`
    expect(count?.n).toBe(1)
  })

  it('a reshare racing an unshare never returns 500', async () => {
    const { owner, space } = await spaceWithMembers(h, 'UnshareRace')
    const url = 'https://example.com/racy'
    for (let run = 0; run < 10; run++) {
      const first = await h.ok(
        'shareItem',
        { params: { spaceId: space.id }, body: { page: page(url, `# base ${run}`) } },
        owner.token,
      )
      const [unshare, reshare] = await Promise.all([
        h.call('unshareItem', { params: { itemId: first.item.id } }, owner.token),
        h.call(
          'shareItem',
          { params: { spaceId: space.id }, body: { page: page(url, `# next ${run}`) } },
          owner.token,
        ),
      ])
      expect(unshare.status).toBe(200)
      expect(reshare.status).toBe(200)
      // Leave nothing behind for the next run.
      const left = await h.sql<{ id: string }[]>`select id from items where space_id = ${space.id}`
      for (const r of left) await h.ok('unshareItem', { params: { itemId: r.id } }, owner.token)
    }
    await h.settle()
  })
})

describe('share rate limit', () => {
  it('a member looping re-shares is cut off with 429 while another member can still share', async () => {
    const limited = await startHarness({
      indexer: noopIndexer,
      env: { SHARE_RATE_LIMIT_PER_MINUTE: '5' },
    })
    try {
      const { owner, member, space } = await spaceWithMembers(limited, 'Flood')
      const statuses: number[] = []
      for (let i = 0; i < 7; i++) {
        const r = await limited.call(
          'shareItem',
          {
            params: { spaceId: space.id },
            body: { page: page('https://example.com/flood', `# v${i}`) },
          },
          owner.token,
        )
        statuses.push(r.status)
      }
      expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429])
      await limited.fails(
        'shareItem',
        { params: { spaceId: space.id }, body: { page: page('https://example.com/other', '# x') } },
        owner.token,
        429,
        'rate_limited',
      )
      await limited.ok(
        'shareItem',
        { params: { spaceId: space.id }, body: { page: page('https://example.com/mine', '# m') } },
        member.token,
      )
      const [versions] = await limited.sql<
        { n: number }[]
      >`select count(*)::int as n from item_versions`
      expect(versions?.n).toBe(6)
      await limited.settle()
    } finally {
      await limited.close()
    }
  })
})

describe('re-indexing an unchanged share', () => {
  it('an identical share while the first index run is in flight does not queue a second run', async () => {
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const gated = await startHarness({
      indexer: {
        async index() {
          calls++
          await gate
        },
      },
    })
    try {
      const { owner, space } = await spaceWithMembers(gated, 'InFlight')
      const body = { page: page('https://example.com/slow', '# same') }
      await gated.ok('shareItem', { params: { spaceId: space.id }, body }, owner.token)
      for (let i = 0; i < 3; i++) {
        const again = await gated.ok(
          'shareItem',
          { params: { spaceId: space.id }, body },
          owner.token,
        )
        expect(again.outcome).toBe('unchanged')
      }
      release()
      await gated.settle()
      expect(calls).toBe(1)
    } finally {
      release()
      await gated.close()
    }
  })
})
