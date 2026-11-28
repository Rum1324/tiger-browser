// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { bindDefaultShortcuts } from '../../../src/renderer/src/app/default-shortcuts'
import { useDownloads } from '../../../src/renderer/src/features/downloads'
import { useExport } from '../../../src/renderer/src/features/export'
import { useFindInPage } from '../../../src/renderer/src/features/find'
import { useItemDetail, useLedger } from '../../../src/renderer/src/features/ledger'
import { useModels } from '../../../src/renderer/src/features/models'
import { usePermissionPrompts } from '../../../src/renderer/src/features/permissions'
import { useConnection, useSignIn } from '../../../src/renderer/src/features/session'
import { useSettings } from '../../../src/renderer/src/features/settings'
import { useShareThread } from '../../../src/renderer/src/features/share-thread'
import {
  useActivity,
  useInvite,
  useMembers,
  useSpaces,
} from '../../../src/renderer/src/features/spaces'
import { useSpaceThread } from '../../../src/renderer/src/features/threads'
import { pages, people, spaceIds } from '../../../src/renderer/src/testing/fixtures'
import { guestSurface, makeWorld, renderHook, settle, type World, waitFor } from './world'

let w: World
afterEach(() => w?.dispose())
const TABS = [{ page: 'pitch', active: true }, { page: 'news' }]

describe('useModels', () => {
  it('groups by tier with the receiving company; select is per question, default persists', async () => {
    w = await makeWorld({ tabs: TABS })
    const h = renderHook(w.services, () => useModels())
    await waitFor(() => h.result.current.groups.length === 3, 'models')
    expect(h.result.current.groups.map((g) => g.tier)).toEqual(['best', 'balanced', 'fast'])
    expect(h.result.current.selected).toMatchObject({
      model: { id: 'claude-sonnet-4-5' },
      company: 'Anthropic',
      isDefault: true,
    })
    const gpt = h.result.current.groups[0]?.options.find((o) => o.model.id === 'gpt-5.1')
    expect(gpt).toMatchObject({ company: 'OpenAI', model: { available: false } })
    await settle(() => h.result.current.select({ provider: 'anthropic', id: 'claude-haiku-4-5' }))
    expect(h.result.current.selected?.model.id).toBe('claude-haiku-4-5')
    await settle(() =>
      h.result.current.setDefault({ provider: 'anthropic', id: 'claude-opus-4-5' }),
    )
    expect(w.engine.settings.defaultModel).toEqual({ provider: 'anthropic', id: 'claude-opus-4-5' })
    expect(h.result.current.defaultRef?.id).toBe('claude-opus-4-5')
  })
})

describe('useLedger and useItemDetail', () => {
  it('lists newest first; unshare asks first in the overlay; who may unshare', async () => {
    w = await makeWorld({ tabs: TABS })
    const h = renderHook(w.services, () => useLedger())
    await waitFor(() => h.result.current.items.length === 6, 'items')
    expect(h.result.current.items[0]?.title).toBe('投資家向けピッチ v3')
    const kpi = h.result.current.items.find((i) => i.title === '月次KPI 2026年10月')
    expect(kpi && h.result.current.canUnshare(kpi)).toBe(true) // owner of 資金調達 2027

    const done = kpi ? h.result.current.confirmUnshare(kpi) : Promise.resolve(false)
    const s = await guestSurface(w, 'confirm')
    expect(s.props).toMatchObject({ subject: '月次KPI 2026年10月', destructive: true })
    w.guest.shown(s.id)
    w.guest.resolve(s.id, true)
    expect(await done).toBe(true)
    await waitFor(() => h.result.current.items.length === 5, 'unshared')
    expect(w.server.requests.filter((r) => r.route === 'unshareItem')).toHaveLength(1)

    // In 採用 the member is not the owner: only their own items.
    await settle(() => w.client.spaces.select(spaceIds.hire))
    await waitFor(() => h.result.current.items.length === 1, 'hire items')
    const plan = h.result.current.items[0]
    expect(plan && h.result.current.canUnshare(plan)).toBe(false)
  })

  it('a dismissed confirmation unshares nothing', async () => {
    w = await makeWorld({ tabs: TABS })
    const h = renderHook(w.services, () => useLedger())
    await waitFor(() => h.result.current.items.length === 6, 'items')
    const first = h.result.current.items[0]
    const done = first ? h.result.current.confirmUnshare(first) : Promise.resolve(true)
    const s = await guestSurface(w, 'confirm')
    w.guest.dismiss(s.id, 'escape')
    expect(await done).toBe(false)
    expect(w.server.requests.some((r) => r.route === 'unshareItem')).toBe(false)
  })

  it('item detail loads Markdown and versions; unsharing it marks it gone', async () => {
    w = await makeWorld({ tabs: TABS })
    const slack = w.world.items.find((i) => i.item.url === pages.slack.url)?.item.id as string
    const h = renderHook(w.services, () => useItemDetail(slack))
    expect(h.result.current.loading).toBe(true)
    await waitFor(() => h.result.current.detail, 'detail')
    expect(h.result.current.versions.map((v) => v.number)).toEqual([5, 4, 3, 2, 1])
    expect(h.result.current.detail?.markdown).toContain('12月3日')
    await settle(() => w.client.items.unshare(slack))
    await waitFor(() => h.result.current.gone, 'gone')
  })
})

describe('useShareThread', () => {
  it('every attached question must be decided; confirm sends exactly the decisions', async () => {
    w = await makeWorld({ tabs: TABS })
    const h = renderHook(w.services, () => useShareThread())
    // The streaming answer has to settle before the thread can be shared.
    await settle(() => w.client.threads.loadMessages(w.world.ids.privateThread))
    await settle(() => w.client.threads.stop(w.world.ids.streamingAnswer))
    await waitFor(
      () => w.world.messages[w.world.ids.privateThread]?.every((m) => m.status !== 'streaming'),
      'stopped',
    )
    await settle(() => h.result.current.begin())
    await waitFor(() => h.result.current.phase === 'deciding', 'deciding')
    if (h.result.current.phase !== 'deciding') throw new Error('not deciding')
    expect(h.result.current.questions.map((q) => q.question.id)).toEqual([
      w.world.ids.attachedQuestion,
    ])
    expect(h.result.current.ready).toBe(false)
    expect(await h.result.current.confirm()).toBe(false)
    expect(w.server.requests.some((r) => r.route === 'shareThread')).toBe(false)
    await settle(() => h.result.current.decide(w.world.ids.attachedQuestion, 'exclude'))
    if (h.result.current.phase !== 'deciding') throw new Error('not deciding')
    expect(h.result.current.ready).toBe(true)
    expect(h.result.current.preview.map((m) => m.id)).not.toContain(w.world.ids.attachedQuestion)
    await settle(() => h.result.current.confirm())
    expect(w.server.requests.find((r) => r.route === 'shareThread')?.body).toEqual({
      includeAttachedMessageIds: [],
      excludeMessageIds: [w.world.ids.attachedQuestion],
    })
    expect(h.result.current.phase).toBe('done')
  })
})

describe('useExport', () => {
  it('copy and file carry the answer with its numbered sources; Google needs a connection', async () => {
    w = await makeWorld({ tabs: TABS })
    const thread = renderHook(w.services, () => useSpaceThread(w.world.ids.spaceThread))
    await waitFor(() => thread.result.current.messages.length === 4, 'messages')
    const answer = thread.result.current.messages[1]
    if (!answer) throw new Error('no answer')
    const h = renderHook(w.services, () => useExport())
    await settle(() => h.result.current.copy(answer))
    const copied = w.engine.callsOf('clipboard.writeText').at(-1)?.text ?? ''
    expect(copied).toContain('38事業所')
    expect(copied).toContain(`[1] 月次KPI 2026年10月 <${pages.kpi.url}>`)
    expect(h.result.current.status).toMatchObject({ state: 'done', target: 'copy' })
    await settle(() => h.result.current.toFile({ title: '面談/準備: 数字', message: answer }))
    expect(w.engine.callsOf('export.saveFile').at(-1)).toMatchObject({
      suggestedName: '面談 準備 数字',
      extension: 'md',
    })
    await settle(() => h.result.current.toGoogleDoc({ title: '面談の準備', message: answer }))
    expect(h.result.current.status).toMatchObject({
      state: 'error',
      target: 'google',
      error: { key: 'export.google.not-connected' },
    })
    expect(w.server.requests.some((r) => r.route === 'recordExport')).toBe(false)
  })
})

describe('Spaces, members, invites, activity', () => {
  it('switching Space, members of the current one, an invite link shown once', async () => {
    w = await makeWorld({ tabs: TABS })
    const spaces = renderHook(w.services, () => useSpaces())
    const members = renderHook(w.services, () => useMembers())
    expect(spaces.result.current.current?.name).toBe('資金調達 2027')
    await waitFor(() => members.result.current.members.length === 4, 'members')
    expect(members.result.current.isOwner).toBe(true)
    expect(members.result.current.pendingInvites.map((i) => i.email)).toEqual([
      'advisor@shiraume-law.example',
    ])
    await settle(() => members.result.current.createInvite('cfo@kotonoha.example'))
    expect(members.result.current.lastInvite?.url).toMatch(/invite#invite-token-/)
    await settle(() => members.result.current.copyInviteLink())
    expect(w.engine.callsOf('clipboard.writeText').at(-1)?.text).toBe(
      members.result.current.lastInvite?.url,
    )
    await settle(() => spaces.result.current.select(spaceIds.product))
    await waitFor(
      () =>
        members.result.current.spaceId === spaceIds.product &&
        members.result.current.members.length === 4,
      'product members',
    )
    expect(members.result.current.isOwner).toBe(false)
    expect(members.result.current.members[0]?.user.id).toBe(people.mori.id)
  })

  it('invite.open from the engine waits for an answer; accept joins', async () => {
    w = await makeWorld({ tabs: TABS })
    const h = renderHook(w.services, () => useInvite())
    expect(h.result.current.pending).toBeNull()
    await settle(() => w.engine.emit('invite.open', { token: 'invite-token-abcdefghij' }))
    expect(h.result.current.pending).toEqual({ token: 'invite-token-abcdefghij' })
    await settle(() => h.result.current.accept())
    expect(w.server.requests.find((r) => r.route === 'acceptInvite')?.body).toEqual({
      token: 'invite-token-abcdefghij',
    })
    expect(h.result.current.pending).toBeNull()
  })

  it('activity: audit trail and the budget used', async () => {
    w = await makeWorld({ tabs: TABS })
    const h = renderHook(w.services, () => useActivity())
    await waitFor(() => h.result.current.audit.length === 4 && h.result.current.usage, 'activity')
    expect(h.result.current.usageRatio).toBeCloseTo((412_000 + 21_400) / 2_000_000)
    expect(h.result.current.audit.map((a) => a.action)).toContain('item.unshared')
  })
})

describe('engine-only features', () => {
  it('permission prompts: the active tab first, remember not offered for screen capture, closed tab dropped', async () => {
    w = await makeWorld({ tabs: TABS })
    const [a, b] = w.engine.state.tabs.map((t) => t.id) as [string, string]
    const h = renderHook(w.services, () => usePermissionPrompts())
    await settle(() => {
      w.engine.emit('permission.request', {
        requestId: 'r1',
        tabId: b,
        origin: 'https://care-keizai.jp',
        permission: 'notifications',
      })
      w.engine.emit('permission.request', {
        requestId: 'r2',
        tabId: a,
        origin: 'https://meet.example',
        permission: 'screen-capture',
      })
    })
    expect(h.result.current.current?.requestId).toBe('r2')
    expect(h.result.current.canRemember).toBe(false)
    expect(h.result.current.waitingTabIds).toEqual([b])
    await settle(() => h.result.current.allow(true))
    expect(w.engine.callsOf('permission.respond')).toEqual([
      { requestId: 'r2', allow: true, remember: false },
    ])
    expect(h.result.current.current).toBeNull()
    await settle(() => w.engine.invoke('tabs.close', { tabId: b }))
    expect(h.result.current.waitingTabIds).toEqual([])
  })

  it('downloads: progress over running ones, cancel and clear go to the engine', async () => {
    w = await makeWorld({ tabs: TABS })
    const h = renderHook(w.services, () => useDownloads())
    expect(h.result.current.active.map((d) => d.id)).toEqual(['d2'])
    expect(h.result.current.progress).toBeCloseTo(310_000 / 820_000)
    await settle(() => h.result.current.cancel('d2'))
    expect(h.result.current.active).toEqual([])
    expect(h.result.current.progress).toBeNull()
    await settle(() => h.result.current.clear())
    expect(h.result.current.list).toEqual([])
  })

  it('find in page: search, results, next; switching tab stops it', async () => {
    w = await makeWorld({ tabs: TABS })
    const h = renderHook(w.services, () => useFindInPage())
    await settle(() => h.result.current.setText('ignored while closed'))
    expect(w.engine.callsOf('page.find')).toEqual([])
    await settle(() => h.result.current.show())
    await settle(() => h.result.current.setText('訪問'))
    await waitFor(() => h.result.current.matches === 2, 'matches')
    expect(h.result.current.activeMatch).toBe(1)
    await settle(() => h.result.current.next())
    expect(w.engine.callsOf('page.find').at(-1)).toMatchObject({
      text: '訪問',
      forward: true,
      findNext: true,
    })
    await settle(() =>
      w.engine.invoke('tabs.activate', { tabId: w.engine.state.tabs[1]?.id as string }),
    )
    expect(h.result.current.open).toBe(false)
    expect(w.engine.callsOf('page.stopFind')).toHaveLength(1)
  })

  it('settings: theme and language; blocked hosts are normalised', async () => {
    w = await makeWorld({ tabs: TABS })
    const h = renderHook(w.services, () => useSettings())
    await settle(() => h.result.current.setTheme('dark'))
    expect(h.result.current.settings?.theme).toBe('dark')
    await settle(() => h.result.current.setLocale('en'))
    expect(w.server.requests.find((r) => r.route === 'updateMe')?.body).toEqual({ locale: 'en' })
    expect(await h.result.current.addBlockedHost('not a host')).toBe(false)
    await settle(() => h.result.current.addBlockedHost('https://Mail.Example.co.jp/inbox'))
    expect(h.result.current.settings?.userBlockedHosts).toEqual([
      'kaikei-cloud.jp',
      'mail.example.co.jp',
    ])
    await settle(() => h.result.current.removeBlockedHost('kaikei-cloud.jp'))
    expect(h.result.current.settings?.userBlockedHosts).toEqual(['mail.example.co.jp'])
  })
})

describe('session', () => {
  it('signed out → dev sign-in → signed in → sign out', async () => {
    w = await makeWorld({ tabs: TABS, signedIn: false })
    const h = renderHook(w.services, () => useSignIn())
    const c = renderHook(w.services, () => useConnection())
    await waitFor(() => h.result.current.status === 'signedOut', 'signed out')
    expect(await h.result.current.devLogin('haruka.saeki@kotonoha.example', '佐伯 遥')).toBe(true)
    expect(h.result.current.user?.name).toBe('佐伯 遥')
    await waitFor(() => c.result.current.state === 'online', 'online')
    expect(c.result.current.notice).toEqual({ key: 'connection.online' })
    await settle(() => h.result.current.signOut())
    expect(h.result.current.status).toBe('signedOut')
  })

  it('a failed Google sign-in is reported as a message key', async () => {
    w = await makeWorld({ tabs: TABS, signedIn: false })
    const h = renderHook(w.services, () => useSignIn())
    await settle(() => h.result.current.signInWithGoogle())
    expect(h.result.current.error).toEqual({ key: 'google.flow.not-configured' })
  })
})

describe('menu shortcuts reach the feature hooks', () => {
  it('each engine shortcut event does its job', async () => {
    w = await makeWorld({ tabs: TABS })
    const unbind = bindDefaultShortcuts(w.services)
    const fire = (action: Parameters<typeof w.engine.emit<'shortcut'>>[1]['action']) =>
      settle(() => w.engine.emit('shortcut', { action }))
    await fire('toggle-side-panel')
    expect(w.services.layout.store.getState().panelOpen).toBe(true)
    await fire('toggle-space-home')
    expect(w.services.router.store.getState().route.name).toBe('space-home')
    await fire('open-settings')
    expect(w.services.router.store.getState().route.name).toBe('settings')
    await fire('focus-address')
    expect(w.services.router.store.getState().route.name).toBe('page')
    expect(w.services.omnibox.store.getState().focusRequest).toBe(1)
    await fire('find')
    expect(w.services.find.store.getState().open).toBe(true)
    await fire('next-tab')
    expect(w.engine.activeTab()?.title).toBe(pages.news.title)
    await fire('bookmark-tab')
    expect(w.engine.callsOf('bookmarks.add')).toEqual([
      { url: pages.news.url, title: pages.news.title, spaceId: spaceIds.fund },
    ])
    await fire('new-tab')
    expect(w.engine.callsOf('tabs.create')).toHaveLength(1)
    await fire('close-tab')
    expect(w.engine.state.tabs).toHaveLength(2)
    await fire('reopen-closed-tab')
    expect(w.engine.state.tabs).toHaveLength(3)
    await fire('new-private-window')
    expect(w.engine.callsOf('window.create').at(-1)).toEqual({ private: true })
    await fire('toggle-command')
    expect((await guestSurface(w, 'palette')).props).toMatchObject({ mode: 'commands' })
    await fire('toggle-command')
    expect(w.services.overlay.store.getState().open).toBeNull()
    await fire('open-history')
    expect((await guestSurface(w, 'palette')).props).toMatchObject({ mode: 'history' })
    await fire('open-downloads')
    const dl = await guestSurface(w, 'downloads')
    expect(dl.placement.mode).toBe('popover')
    await fire('share-tab')
    await guestSurface(w, 'share')
    unbind()
    await fire('toggle-side-panel')
    expect(w.services.layout.store.getState().panelOpen).toBe(true)
  })

  it('a component can take an action over and give it back', async () => {
    w = await makeWorld({ tabs: TABS })
    const unbind = bindDefaultShortcuts(w.services)
    const calls: string[] = []
    const off = w.services.shortcuts.on('find', () => calls.push('mine'))
    await settle(() => w.engine.emit('shortcut', { action: 'find' }))
    expect(calls).toEqual(['mine'])
    expect(w.services.find.store.getState().open).toBe(false)
    off()
    await settle(() => w.engine.emit('shortcut', { action: 'find' }))
    expect(w.services.find.store.getState().open).toBe(true)
    unbind()
  })
})
