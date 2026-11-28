// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { useAttach } from '../../../src/renderer/src/features/attach'
import { useOmnibox } from '../../../src/renderer/src/features/omnibox'
import { presentPalette, usePalette } from '../../../src/renderer/src/features/palette'
import { useShare } from '../../../src/renderer/src/features/share'
import {
  useAskPanel,
  useSpaceThread,
  useThreadList,
} from '../../../src/renderer/src/features/threads'
import { pages, spaceIds } from '../../../src/renderer/src/testing/fixtures'
import { guestSurface, makeWorld, renderHook, settle, type World, waitFor } from './world'

let w: World
afterEach(() => w?.dispose())

describe('useOmnibox', () => {
  it('suggestions from the engine, keyboard selection, Enter switches or navigates; follows the tab', async () => {
    w = await makeWorld({ tabs: [{ page: 'pitch', active: true }, { page: 'news' }] })
    const h = renderHook(w.services, () => useOmnibox())
    expect(h.result.current.text).toBe(pages.pitch.url)
    await settle(() => h.result.current.begin())
    await settle(() => h.result.current.setText('介護'))
    await waitFor(() => h.result.current.suggestions.length > 0, 'suggestions')
    expect(h.result.current.suggestions[0]).toMatchObject({ kind: 'tab', title: pages.news.title })
    expect(w.engine.callsOf('suggest.query').at(-1)).toEqual({ input: '介護' })
    await settle(() => h.result.current.handleKey('ArrowDown'))
    expect(h.result.current.current?.kind).toBe('tab')
    await settle(() => h.result.current.handleKey('Enter'))
    await waitFor(() => w.engine.activeTab()?.url === pages.news.url, 'switched to the tab')
    expect(h.result.current.editing).toBe(false)
    expect(h.result.current.text).toBe(pages.news.url)

    await settle(() => h.result.current.setText('kotonoha.example/demo'))
    await settle(() => h.result.current.commit())
    expect(w.engine.callsOf('tabs.navigate').at(-1)).toMatchObject({
      input: 'kotonoha.example/demo',
    })
  })

  it('a late answer for older text is dropped; Escape closes suggestions, then reverts', async () => {
    w = await makeWorld({ tabs: [{ page: 'pitch', active: true }, { page: 'news' }] })
    const h = renderHook(w.services, () => useOmnibox())
    await settle(() => h.result.current.setText('介'))
    await settle(() => h.result.current.setText('xyz-nothing'))
    await waitFor(() => h.result.current.suggestions.length > 0, 'suggestions')
    expect(h.result.current.suggestions.every((s) => s.kind === 'search' || s.kind === 'url')).toBe(
      true,
    )
    expect(h.result.current.escape()).toBe('closed-suggestions')
    await settle()
    expect(h.result.current.escape()).toBe('reverted')
    await settle()
    expect(h.result.current.text).toBe(pages.pitch.url)
  })
})

describe('palette', () => {
  it('opens in the overlay with the commands that apply; a chosen command runs in the main view', async () => {
    w = await makeWorld({ tabs: [{ page: 'pitch', active: true }] })
    const h = renderHook(w.services, () => usePalette())
    const done = presentPalette(w.services)
    const s = await guestSurface(w, 'palette')
    expect(h.result.current.open).toBe(true)
    const ids = (s.props as { commands: { id: string }[] }).commands.map((c) => c.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'new-tab',
        'share',
        'attach',
        'ask',
        `switch-space:${spaceIds.hire}`,
      ]),
    )
    expect(ids).not.toContain(`switch-space:${spaceIds.fund}`)
    w.guest.shown(s.id)
    w.guest.resolve(s.id, { kind: 'command', id: 'new-tab' })
    await done
    expect(w.engine.callsOf('tabs.create')).toHaveLength(1)
    expect(w.engine.overlay.open).toBe(false)
  })

  it('a private window offers no share or attach; toggle closes an open palette', async () => {
    w = await makeWorld({ tabs: [{ page: 'pitch', active: true }], privateWindow: true })
    const h = renderHook(w.services, () => usePalette())
    void h.result.current.show()
    const s = await guestSurface(w, 'palette')
    const ids = (s.props as { commands: { id: string }[] }).commands.map((c) => c.id)
    expect(ids).not.toContain('share')
    expect(ids).not.toContain('attach')
    await settle(() => h.result.current.toggle())
    expect(h.result.current.open).toBe(false)
  })
})

describe('useShare: preview first, the previewed page is exactly what is sent', () => {
  it('idle → extracting → preview → sending → done', async () => {
    w = await makeWorld({ tabs: [{ page: 'news', active: true }] })
    const h = renderHook(w.services, () => useShare())
    const seen: string[] = []
    const off = w.client.share.store.subscribe((s) => seen.push(s.phase))
    expect(h.result.current.phase).toBe('idle')
    await settle(() => h.result.current.begin())
    expect(h.result.current).toMatchObject({
      phase: 'preview',
      space: { name: '資金調達 2027' },
      existing: null,
      changed: null,
    })
    expect(w.server.requests.some((r) => r.route === 'shareItem')).toBe(false)
    const page = h.result.current.phase === 'preview' ? h.result.current.page : null
    await settle(() => h.result.current.confirm())
    expect(h.result.current).toMatchObject({ phase: 'done', outcome: 'new' })
    expect(w.server.requests.filter((r) => r.route === 'shareItem').map((r) => r.body)).toEqual([
      { page },
    ])
    expect(seen).toEqual(['extracting', 'preview', 'sending', 'done'])
    off()
  })

  it('re-sharing a changed page offers a version; a blocked page fails in the capture step', async () => {
    w = await makeWorld({ tabs: [{ page: 'notion', active: true }, { page: 'gmail' }] })
    const h = renderHook(w.services, () => useShare())
    await settle(() => h.result.current.begin())
    expect(h.result.current).toMatchObject({
      phase: 'preview',
      changed: true,
      existing: { versionNumber: 2 },
    })
    await settle(() => h.result.current.cancel())
    expect(h.result.current.phase).toBe('idle')
    await settle(() => h.result.current.begin(w.engine.state.tabs[1]?.id))
    expect(h.result.current).toMatchObject({
      phase: 'error',
      error: { key: 'capture.reason.email' },
    })
    expect(w.server.requests.some((r) => r.route === 'shareItem')).toBe(false)
  })

  it('present(): the sheet follows the flow; its confirm event shares and closes it', async () => {
    w = await makeWorld({ tabs: [{ page: 'news', active: true }] })
    const h = renderHook(w.services, () => useShare())
    const result = h.result.current.present()
    const s = await guestSurface(w, 'share')
    w.guest.shown(s.id)
    await waitFor(
      () =>
        (w.guest.store.getState().current?.props as { phase: string } | undefined)?.phase ===
        'preview',
      'preview in the sheet',
    )
    w.guest.emit(s.id, { type: 'confirm' })
    expect(await result).toBe(true)
    expect(w.guest.store.getState().current).toBeNull()
    expect(w.server.requests.filter((r) => r.route === 'shareItem')).toHaveLength(1)
  })

  it('present() cancelled: nothing is sent and the flow is reset', async () => {
    w = await makeWorld({ tabs: [{ page: 'news', active: true }] })
    const h = renderHook(w.services, () => useShare())
    const result = h.result.current.present()
    const s = await guestSurface(w, 'share')
    w.guest.shown(s.id)
    await settle()
    w.guest.dismiss(s.id, 'escape')
    expect(await result).toBe(false)
    expect(w.client.share.store.getState().phase).toBe('idle')
    expect(w.server.requests.some((r) => r.route === 'shareItem')).toBe(false)
  })
})

describe('useAttach: one question only, with the receiving company', () => {
  it('preview names the provider; confirm adds to the draft; the page leaves only with the question', async () => {
    w = await makeWorld({
      tabs: [{ page: 'news', active: true }],
      edit: (world) => {
        for (const m of world.models.models) if (m.id === 'gpt-5.1') m.available = true
      },
    })
    const h = renderHook(w.services, () => useAttach())
    expect(h.result.current).toMatchObject({
      phase: 'idle',
      company: 'Anthropic',
      drafts: [],
      max: 3,
    })
    await settle(() => h.result.current.begin())
    expect(h.result.current.phase).toBe('preview')
    expect(h.result.current.page?.url).toBe(pages.news.url)
    await settle(() => h.result.current.confirm())
    expect(h.result.current.drafts.map((d) => d.url)).toEqual([pages.news.url])
    expect(w.server.requests.some((r) => r.route === 'postMessage')).toBe(false)
    // An unavailable model cannot be chosen; choosing an OpenAI model changes who receives it.
    await settle(() => w.client.models.select({ provider: 'google', id: 'gemini-3-pro' }))
    expect(h.result.current.company).toBe('Anthropic')
    await settle(() => w.client.models.select({ provider: 'openai', id: 'gpt-5.1' }))
    expect(h.result.current.company).toBe('OpenAI')
    await settle(() => h.result.current.remove(0))
    expect(h.result.current.drafts).toEqual([])
  })
})

describe('ask panel and Space threads', () => {
  it('opening the panel loads the private thread: streaming answer, stop, ask', async () => {
    w = await makeWorld({ tabs: [{ page: 'pitch', active: true }] })
    const h = renderHook(w.services, () => useAskPanel())
    expect(h.result.current.open).toBe(false)
    await settle(() => h.result.current.setOpen(true))
    await waitFor(() => h.result.current.messages.length === 6, 'messages')
    expect(h.result.current.sharedCount).toBe(6)
    expect(h.result.current.streaming?.id).toBe(w.world.ids.streamingAnswer)
    expect(h.result.current.streaming?.canStop).toBe(true)
    await settle(() => h.result.current.stop())
    await waitFor(() => h.result.current.streaming === null, 'stopped')
    const stopped = h.result.current.messages.find((m) => m.id === w.world.ids.streamingAnswer)
    expect(stopped).toMatchObject({ phase: 'aborted', failureNotice: { key: 'ai.ai_aborted' } })

    await settle(() => h.result.current.ask('  '))
    expect(w.server.requests.some((r) => r.route === 'postMessage')).toBe(false)
    await settle(() => h.result.current.ask('記事の数字を表にしてください'))
    const post = w.server.requests.find((r) => r.route === 'postMessage')
    expect(post?.body).toMatchObject({ content: '記事の数字を表にしてください', askAi: true })
  })

  it('a Space thread: cited answers, an unshared citation does not open, posting with askAi', async () => {
    w = await makeWorld({ tabs: [{ page: 'pitch', active: true }] })
    const h = renderHook(w.services, () => useSpaceThread(w.world.ids.spaceThread))
    await waitFor(() => h.result.current.messages.length === 4, 'messages')
    const answer = h.result.current.messages[1]
    expect(answer?.citations.map((c) => c.n)).toEqual([1, 2, 3])
    const gone = h.result.current.messages[3]?.citations[1]
    expect(gone?.available).toBe(false)
    await settle(() => gone && h.result.current.openCitation(gone))
    expect(w.services.router.store.getState().route.name).toBe('page')
    await settle(() => answer?.citations[0] && h.result.current.openCitation(answer.citations[0]))
    expect(w.services.router.store.getState().route).toMatchObject({ name: 'item' })
    await settle(() => h.result.current.post('了解です', false))
    expect(w.server.requests.find((r) => r.route === 'postMessage')?.body).toMatchObject({
      content: '了解です',
      askAi: false,
    })
  })

  it('thread list splits Space and private threads; create opens the new one', async () => {
    w = await makeWorld({ tabs: [{ page: 'pitch', active: true }] })
    const h = renderHook(w.services, () => useThreadList())
    await waitFor(() => h.result.current.spaceThreads.length === 1, 'threads')
    expect(h.result.current.privateThreads).toHaveLength(1)
    await settle(() => h.result.current.create('12月の面談'))
    expect(w.services.router.store.getState().route).toMatchObject({
      name: 'space-home',
      section: 'threads',
    })
    expect(h.result.current.spaceThreads.map((t) => t.title)).toContain('12月の面談')
  })
})
