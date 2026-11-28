import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dictionaries as clientDictionaries } from '@tiger/client'
import type { Tab } from '@tiger/shared'
import { describe, expect, it } from 'vitest'
import type { CommandDescriptor } from '../../../src/renderer/src/app/commands'
import { localPrefsStorage, memoryPrefsStorage } from '../../../src/renderer/src/app/prefs'
import { coversPage, createRouter, resolveSurface } from '../../../src/renderer/src/app/router'
import { createShortcuts } from '../../../src/renderer/src/app/shortcuts'
import { frameAttributes, resolveTheme } from '../../../src/renderer/src/app/theme'
import { downloadsProgress } from '../../../src/renderer/src/features/downloads'
import { fileNameOf } from '../../../src/renderer/src/features/export'
import { pageShareState } from '../../../src/renderer/src/features/page-share'
import { createPaletteModel, paletteRows } from '../../../src/renderer/src/features/palette'
import { normalizeHost } from '../../../src/renderer/src/features/settings'
import { answerParts } from '../../../src/renderer/src/features/threads'
import { en, ja, translate, UI_KEYS } from '../../../src/renderer/src/i18n'
import { createLayout } from '../../../src/renderer/src/layout/layout-state'
import { createStore, shallow } from '../../../src/renderer/src/lib/store'
import { LAYOUT_TOKENS } from '../../../src/renderer/src/theme'

const tab = (patch: Partial<Tab> = {}): Tab => ({
  id: 't1',
  url: 'https://care-keizai.jp/a',
  title: 'a',
  faviconUrl: null,
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  isPrivate: false,
  spaceId: null,
  pinned: false,
  audible: false,
  crashed: false,
  security: 'secure',
  capture: { allowed: true, reason: null, rule: null },
  loadError: null,
  zoomFactor: 1,
  ...patch,
})

describe('router', () => {
  const ctx = { activeTab: tab(), session: 'signedIn' as const, firstRunDone: true }
  it('resolves routes to surfaces in context', () => {
    expect(resolveSurface({ name: 'page' }, ctx)).toEqual({ name: 'page' })
    expect(resolveSurface({ name: 'page' }, { ...ctx, activeTab: tab({ url: '' }) })).toEqual({ name: 'new-tab', tabId: 't1' })
    // A blank tab that is loading something is not the new-tab page.
    expect(resolveSurface({ name: 'page' }, { ...ctx, activeTab: tab({ url: '', isLoading: true }) })).toEqual({ name: 'page' })
    expect(resolveSurface({ name: 'page' }, { ...ctx, activeTab: null })).toEqual({ name: 'new-tab', tabId: null })
    expect(resolveSurface({ name: 'item', itemId: 'x' }, { ...ctx, session: 'signedOut' })).toEqual({ name: 'sign-in' })
    expect(resolveSurface({ name: 'space-home', section: 'items' }, { ...ctx, session: 'booting' })).toMatchObject({ name: 'space-home' })
    expect(resolveSurface({ name: 'sign-in' }, ctx)).toEqual({ name: 'page' })
    expect(resolveSurface({ name: 'page' }, { ...ctx, firstRunDone: false })).toEqual({ name: 'first-run' })
    expect(resolveSurface({ name: 'settings', section: 'general' }, { ...ctx, firstRunDone: false })).toMatchObject({ name: 'settings' })
    expect(coversPage({ name: 'page' })).toBe(false)
    expect(coversPage({ name: 'new-tab', tabId: null })).toBe(true)
  })
  it('go, back, toggle, history bound', () => {
    const r = createRouter()
    r.go({ name: 'settings', section: 'general' })
    r.go({ name: 'settings', section: 'general' })
    expect(r.store.getState().history).toHaveLength(1)
    r.toggle({ name: 'settings', section: 'privacy' })
    expect(r.store.getState().route).toEqual({ name: 'page' })
    r.back()
    expect(r.store.getState().route.name).toBe('settings')
    for (let i = 0; i < 80; i++) r.go({ name: 'item', itemId: String(i) })
    expect(r.store.getState().history.length).toBe(50)
  })
})

describe('theme and frame attributes', () => {
  it('resolves the setting and the system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(frameAttributes({ hue: 'amber', privateWindow: false })).toEqual({ 'data-space': 'amber', 'data-window': 'normal' })
    expect(frameAttributes({ hue: 'amber', privateWindow: true })).toEqual({ 'data-space': 'none', 'data-window': 'private' })
    expect(frameAttributes({ hue: null, privateWindow: false })['data-space']).toBe('none')
  })
  it('tokens.css is the design file and defines what the plumbing reads', () => {
    const css = readFileSync(join(__dirname, '../../../src/renderer/src/theme/tokens.css'), 'utf8')
    for (const t of LAYOUT_TOKENS) expect(css).toMatch(new RegExp(`${t}\\s*:`))
    expect(css).toContain('[data-theme="dark"]')
    for (const hue of ['amber', 'coral', 'rose', 'violet', 'indigo', 'sky', 'teal', 'green', 'graphite', 'none'])
      expect(css).toContain(`[data-space="${hue}"]`)
    expect(css).toContain('[data-window="private"]')
  })
})

describe('i18n', () => {
  it('English has every Japanese key, with the same placeholders', () => {
    expect(Object.keys(en).sort()).toEqual([...UI_KEYS].sort())
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const k of UI_KEYS) expect(vars(en[k]), k).toEqual(vars(ja[k]))
    for (const k of UI_KEYS) expect(ja[k].trim(), k).not.toBe('')
  })
  it('UI keys never shadow the client’s messages; both resolve through one translate', () => {
    const client = Object.keys(clientDictionaries.ja)
    expect(UI_KEYS.filter((k) => client.includes(k))).toEqual([])
    expect(translate('ja', 'pageState.members', { count: 4 })).toBe('メンバー4人に見えます')
    expect(translate('en', 'error.thread_not_found')).toBe(clientDictionaries.en['error.thread_not_found'])
    expect(translate('ja', 'share.title')).toBe('「{space}」に共有')
  })
})

describe('palette rows and model', () => {
  const cmd = (id: string, label: string, keywords: string[] = []): CommandDescriptor => ({
    id: id as CommandDescriptor['id'],
    label: { key: 'command.newTab' },
    group: 'commands',
    keywords: [label, ...keywords],
  })
  const commands = [cmd('new-tab', '新しいタブ', ['new tab']), cmd('share', 'スペースに共有', ['share']), cmd('settings', '設定', ['settings'])]
  const labelOf = (c: CommandDescriptor) => c.keywords[0] as string

  it('prefix matches first, then substring; suggestions grouped after commands', () => {
    const rows = paletteRows('se', commands, [
      { kind: 'search', title: 'se', url: 'https://www.google.com/search?q=se', tabId: null },
      { kind: 'tab', title: 'Settings', url: 'https://x', tabId: 't1' },
    ], labelOf)
    expect(rows.map((r) => (r.kind === 'command' ? r.command.id : r.suggestion.kind))).toEqual(['settings', 'tab', 'search'])
    expect(paletteRows('', commands, [], labelOf)).toHaveLength(3)
    expect(paletteRows('zzz', commands, [], labelOf)).toEqual([])
  })

  it('keyboard: arrows wrap, Enter returns the choice, typed text when nothing matches', async () => {
    const calls: unknown[] = []
    const model = createPaletteModel({
      bridge: { invoke: (async (name: string, req: unknown) => (calls.push([name, req]), [])) as never },
      props: { mode: 'commands', initialQuery: '', commands },
      labelOf,
      debounceMs: 0,
    })
    expect(model.handleKey('Enter').choice).toEqual({ kind: 'command', id: 'new-tab' })
    model.handleKey('ArrowUp')
    expect(model.choice()).toEqual({ kind: 'command', id: 'settings' })
    model.setQuery('kotonoha.example')
    await new Promise((r) => setTimeout(r, 5))
    expect(calls).toEqual([['suggest.query', { input: 'kotonoha.example' }]])
    expect(model.choice()).toEqual({ kind: 'text', text: 'kotonoha.example' })
    model.dispose()
  })

  it('history mode lists history at once', async () => {
    const model = createPaletteModel({
      bridge: { invoke: (async () => [{ id: 'h', url: 'https://a.jp', title: 'A', visitedAt: '2026-11-26T00:00:00.000Z', visitCount: 1 }]) as never },
      props: { mode: 'history', initialQuery: '', commands },
      labelOf,
      debounceMs: 0,
    })
    await new Promise((r) => setTimeout(r, 5))
    expect(model.store.getState().rows).toEqual([{ kind: 'suggestion', group: 'history', suggestion: { kind: 'history', title: 'A', url: 'https://a.jp', tabId: null } }])
  })
})

describe('small pure helpers', () => {
  it('answerParts splits [n] markers into chips', () => {
    const c = { n: 1 } as never
    expect(answerParts('38事業所です[1]。継続率[2]', [c])).toEqual([
      { kind: 'text', text: '38事業所です' },
      { kind: 'cite', n: 1, citation: c },
      { kind: 'text', text: '。継続率' },
      { kind: 'cite', n: 2, citation: null },
    ])
  })
  it('normalizeHost, fileNameOf, downloadsProgress', () => {
    expect(normalizeHost('https://Mail.Example.co.jp/x')).toBe('mail.example.co.jp')
    expect(normalizeHost('*.bank.example.')).toBe('bank.example')
    expect(normalizeHost('localhost')).toBeNull()
    expect(normalizeHost('')).toBeNull()
    expect(fileNameOf('a/b:c*?"<>|d')).toBe('a b c d')
    expect(fileNameOf('   ')).toBe('tiger')
    expect(fileNameOf('x'.repeat(200))).toHaveLength(80)
    expect(downloadsProgress([])).toBeNull()
  })
  it('pageShareState: browser pages show nothing; blocked wins over everything but private', () => {
    const base = {
      session: 'signedIn' as const,
      currentSpace: null,
      spaces: [],
      urlShare: null,
      stale: null,
      shareFlow: { phase: 'idle' as const },
      attachedKeys: [],
      justShared: null,
    }
    expect(pageShareState({ ...base, tab: tab({ url: 'tiger://settings', capture: { allowed: false, reason: 'scheme', rule: null } }) }).state).toBe('none')
    expect(pageShareState({ ...base, tab: tab({ capture: { allowed: false, reason: 'government-id', rule: 'e-tax' } }) })).toMatchObject({ state: 'blocked', reason: 'government-id', rule: 'e-tax' })
    expect(pageShareState({ ...base, tab: tab({ isPrivate: true, capture: { allowed: false, reason: 'incognito', rule: null } }) }).state).toBe('private')
    expect(pageShareState({ ...base, tab: tab() })).toMatchObject({ state: 'local', canShare: false, why: 'no-space' })
  })
})

describe('stores, prefs, layout, shortcuts', () => {
  it('createStore skips no-op updates; shallow compares one level', () => {
    const s = createStore({ a: 1, b: [1] })
    let n = 0
    s.subscribe(() => n++)
    s.setState({ a: 1 })
    s.setState({ a: 2 })
    expect(n).toBe(1)
    expect(shallow({ x: 1, y: 'a' }, { x: 1, y: 'a' })).toBe(true)
    expect(shallow([1, 2], [1, 2])).toBe(true)
    expect(shallow({ x: {} }, { x: {} })).toBe(false)
  })
  it('prefs survive bad storage; layout clamps widths and persists', () => {
    const broken = { getItem: () => '{not json', setItem: () => { throw new Error('full') } } as unknown as Storage
    const p = localPrefsStorage(broken)
    expect(p.load()).toEqual({})
    expect(() => p.save({ firstRunDone: true, sidebarCollapsed: false, panelOpen: false, sidebarWidth: null, panelWidth: null })).not.toThrow()
    const mem = memoryPrefsStorage({ panelOpen: true })
    const layout = createLayout(mem)
    expect(layout.store.getState().panelOpen).toBe(true)
    layout.setPanelWidth(9999)
    layout.setSidebarWidth(10)
    expect(mem.saved).toMatchObject({ panelWidth: 520, sidebarWidth: 200 })
    const rev = layout.store.getState().revision
    layout.invalidate()
    expect(layout.store.getState().revision).toBe(rev + 1)
  })
  it('shortcuts: the latest handler wins and gives the action back', () => {
    const s = createShortcuts()
    const calls: string[] = []
    expect(s.dispatch('find')).toBe(false)
    const a = s.on('find', () => calls.push('a'))
    const b = s.on('find', () => calls.push('b'))
    s.dispatch('find')
    b()
    b()
    s.dispatch('find')
    a()
    expect(s.handled('find')).toBe(false)
    expect(calls).toEqual(['b', 'a'])
  })
})
