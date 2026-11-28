import { describe, expect, it } from 'vitest'
import { createStaleness, STALE_CHECK_INTERVAL_MS, type StalenessDeps } from '../src'
import type { StaleCheck } from '../src/stores/share'

/** The staleness policy of DESIGN.md 15.2 item 9, with a fake clock and fake checks. */

function setup(urls: Record<string, string>, shared = (_url: string) => true) {
  let clock = 1_000_000
  const checks: string[] = []
  let answer: StaleCheck = { status: 'not-shared' }
  const deps: StalenessDeps = {
    tabUrl: (id) => urls[id] ?? null,
    isShared: shared,
    check: async (id) => {
      checks.push(id)
      return answer
    },
    now: () => clock,
  }
  const s = createStaleness(deps)
  return {
    s,
    checks,
    urls,
    advance: (ms: number) => {
      clock += ms
    },
    answer: (a: StaleCheck) => {
      answer = a
    },
    now: () => clock,
  }
}

const WEB = 'https://example.com/a'
const DOC = 'https://docs.google.com/document/d/abc/edit'
const SHEET = 'https://docs.google.com/spreadsheets/d/abc/edit'
const SLIDES = 'https://docs.google.com/presentation/d/abc/edit'

describe('staleness policy', () => {
  it('checks at most once per 60 seconds per tab, whatever the trigger', async () => {
    const { s, checks, advance, now } = setup({ t1: WEB, t2: WEB })
    await s.request('t1', 'tab-activated')
    expect(s.store.getState().tabs.t1?.lastCheckedAt).toBe(now())
    await s.request('t1', 'surface-opened')
    await s.request('t1', 'explicit')
    expect(checks).toEqual(['t1'])
    // Another tab has its own interval.
    await s.request('t2', 'surface-opened')
    expect(checks).toEqual(['t1', 't2'])
    advance(STALE_CHECK_INTERVAL_MS - 1)
    await s.request('t1', 'tab-activated')
    expect(checks).toEqual(['t1', 't2'])
    advance(1)
    await s.request('t1', 'tab-activated')
    expect(checks).toEqual(['t1', 't2', 't1'])
    expect(s.store.getState().tabs.t1?.lastCheckedAt).toBe(now())
  })

  it('returns the last result while the interval runs, and shares a check in flight', async () => {
    const { s, checks, answer } = setup({ t1: WEB })
    answer({ status: 'not-shared' })
    const [a, b] = await Promise.all([
      s.request('t1', 'tab-activated'),
      s.request('t1', 'surface-opened'),
    ])
    expect(checks).toEqual(['t1'])
    expect(a).toEqual({ status: 'not-shared' })
    expect(b).toEqual(a)
    expect(await s.request('t1', 'explicit')).toEqual(a)
  })

  it('checks Google Docs, Sheets and Slides only on explicit request', async () => {
    const { s, checks } = setup({ d: DOC, sh: SHEET, sl: SLIDES })
    for (const id of ['d', 'sh', 'sl']) {
      expect(await s.request(id, 'tab-activated')).toBeNull()
      expect(await s.request(id, 'surface-opened')).toBeNull()
    }
    expect(checks).toEqual([])
    for (const id of ['d', 'sh', 'sl']) await s.request(id, 'explicit')
    expect(checks).toEqual(['d', 'sh', 'sl'])
  })

  it('never checks a page that is not shared in the current Space, or an unknown tab', async () => {
    const { s, checks } = setup({ t1: WEB }, () => false)
    expect(await s.request('t1', 'explicit')).toBeNull()
    expect(await s.request('nope', 'explicit')).toBeNull()
    expect(checks).toEqual([])
  })

  it('starts afresh when the tab navigates to another page', async () => {
    const { s, checks, urls } = setup({ t1: WEB })
    await s.request('t1', 'tab-activated')
    urls.t1 = 'https://example.com/b'
    await s.request('t1', 'tab-activated')
    expect(checks).toEqual(['t1', 't1'])
    expect(s.store.getState().tabs.t1?.url).toBe('https://example.com/b')
  })

  it('checks a tab when it becomes active (not again while it stays active) and forgets closed tabs', async () => {
    const { s, checks, advance } = setup({ t1: WEB, t2: WEB })
    s.tabsChanged(
      [
        { id: 't1', url: WEB },
        { id: 't2', url: WEB },
      ],
      't1',
    )
    await Promise.resolve()
    advance(STALE_CHECK_INTERVAL_MS)
    s.tabsChanged(
      [
        { id: 't1', url: WEB },
        { id: 't2', url: WEB },
      ],
      't1',
    )
    s.tabsChanged(
      [
        { id: 't1', url: WEB },
        { id: 't2', url: WEB },
      ],
      't2',
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(checks).toEqual(['t1', 't2'])
    expect(Object.keys(s.store.getState().tabs).sort()).toEqual(['t1', 't2'])
    s.tabsChanged([{ id: 't2', url: WEB }], 't2')
    expect(Object.keys(s.store.getState().tabs)).toEqual(['t2'])
  })

  it('a check that fails keeps the previous result and counts against the interval', async () => {
    const { s, checks } = setup({ t1: WEB })
    const failing = createStaleness({
      tabUrl: () => WEB,
      isShared: () => true,
      check: async () => {
        throw new Error('extraction failed')
      },
    })
    expect(await failing.request('t1', 'explicit')).toBeNull()
    expect(failing.store.getState().tabs.t1).toMatchObject({ checking: false, lastCheckedAt: null })
    await s.request('t1', 'explicit')
    expect(checks).toEqual(['t1'])
  })
})
