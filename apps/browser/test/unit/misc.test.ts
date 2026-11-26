import { join } from 'node:path'
import { ShortcutAction } from '@tiger/shared'
import { describe, expect, it } from 'vitest'
import { safeFileName, uniquePath } from '../../src/main/files'
import { inviteTokenFromUrl } from '../../src/main/invite'
import { appMenuTemplate, pageMenuTemplate, shortcutItems } from '../../src/main/menus'
import { resolveUiFile, UI_CSP, uiCsp } from '../../src/main/protocol'
import { mergeSuggestions } from '../../src/main/suggest'
import { chromeLikeUserAgent } from '../../src/main/user-agent'
import { nextZoom } from '../../src/main/zoom'

describe('mergeSuggestions', () => {
  const bookmark = (url: string, title: string) => ({
    id: url,
    url,
    title,
    faviconUrl: null,
    spaceId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  })
  const visit = (url: string, title: string) => ({
    id: url,
    url,
    title,
    visitedAt: '2026-01-01T00:00:00.000Z',
    visitCount: 1,
  })

  it('orders URL, tabs, bookmarks, history, search and removes duplicates', () => {
    const out = mergeSuggestions('example.com', {
      tabs: [
        { id: 't1', url: 'https://example.com/', title: 'Example' },
        { id: 't2', url: 'https://other.org/', title: 'Other' },
      ],
      bookmarks: [bookmark('https://example.com/docs', 'Docs')],
      history: [
        visit('https://example.com/docs', 'Docs again'),
        visit('https://example.com/blog', 'Blog'),
      ],
      engine: 'google',
    })
    expect(out.map((s) => [s.kind, s.url])).toEqual([
      ['url', 'https://example.com/'],
      ['tab', 'https://example.com/'],
      ['bookmark', 'https://example.com/docs'],
      ['history', 'https://example.com/blog'],
      ['search', 'https://www.google.com/search?q=example.com'],
    ])
    expect(out[1]?.tabId).toBe('t1')
  })

  it('offers only a search for plain words and nothing for blank input', () => {
    const src = { tabs: [], bookmarks: [], history: [], engine: 'bing' as const }
    expect(mergeSuggestions('rice', src)).toEqual([
      { kind: 'search', title: 'rice', url: 'https://www.bing.com/search?q=rice', tabId: null },
    ])
    expect(mergeSuggestions('  ', src)).toEqual([])
  })
})

describe('menus', () => {
  it('maps every contract shortcut to exactly one unique accelerator on each platform', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const items = shortcutItems(platform)
      expect(items.map((i) => i.action).sort()).toEqual([...ShortcutAction.options].sort())
      expect(new Set(items.map((i) => i.accelerator)).size).toBe(items.length)
    }
  })

  it('the application menu emits the shortcut action when clicked', () => {
    const fired: string[] = []
    const noop = () => {}
    const template = appMenuTemplate('linux', {
      shortcut: (a) => fired.push(a),
      reload: noop,
      back: noop,
      forward: noop,
      zoom: noop,
      toggleDevTools: noop,
    })
    const all = template.flatMap((m) => (Array.isArray(m.submenu) ? m.submenu : []))
    const ids = all.map((i) => i.id).filter((id): id is string => !!id?.startsWith('shortcut:'))
    expect(ids).toHaveLength(ShortcutAction.options.length)
    const find = all.find((i) => i.id === 'shortcut:find')
    ;(find?.click as (() => void) | undefined)?.()
    expect(fired).toEqual(['find'])
  })

  const params = {
    x: 1,
    y: 2,
    linkURL: '',
    srcURL: '',
    mediaType: 'none' as const,
    hasImageContents: false,
    selectionText: '',
    isEditable: false,
    editFlags: {
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: false,
      canPaste: true,
      canDelete: false,
      canSelectAll: true,
      canEditRichly: false,
    },
    misspelledWord: '',
    dictionarySuggestions: [],
  }
  const calls: string[] = []
  const actions = {
    back: () => calls.push('back'),
    forward: () => calls.push('forward'),
    reload: () => calls.push('reload'),
    openInNewTab: (u: string) => calls.push(`open ${u}`),
    copyText: (t: string) => calls.push(`copy ${t}`),
    copyImageAt: () => calls.push('copy-image'),
    downloadUrl: (u: string) => calls.push(`download ${u}`),
    searchFor: (t: string) => calls.push(`search ${t}`),
    replaceMisspelling: () => {},
    inspect: () => {},
  }
  const ids = (t: ReturnType<typeof pageMenuTemplate>) => t.map((i) => i.id ?? i.role ?? i.type)

  it('page menu: navigation on empty space, link and image actions, edit roles', () => {
    expect(
      ids(pageMenuTemplate(params, { canGoBack: true, canGoForward: false }, actions, false)),
    ).toEqual(['back', 'forward', 'reload'])
    const link = pageMenuTemplate(
      { ...params, linkURL: 'https://a.example/x' },
      { canGoBack: false, canGoForward: false },
      actions,
      false,
    )
    expect(ids(link)).toEqual(['open-link-new-tab', 'copy-link', 'save-link'])
    ;(link[0]?.click as (() => void) | undefined)?.()
    expect(calls).toContain('open https://a.example/x')
    const js = pageMenuTemplate(
      { ...params, linkURL: 'javascript:alert(1)' },
      { canGoBack: false, canGoForward: false },
      actions,
      false,
    )
    expect(ids(js)).not.toContain('open-link-new-tab')
    const img = pageMenuTemplate(
      { ...params, mediaType: 'image', srcURL: 'https://a.example/i.png', hasImageContents: true },
      { canGoBack: false, canGoForward: false },
      actions,
      true,
    )
    expect(ids(img)).toEqual([
      'open-image-new-tab',
      'save-image',
      'copy-image',
      'copy-image-url',
      'separator',
      'inspect',
    ])
    const edit = pageMenuTemplate(
      { ...params, isEditable: true },
      { canGoBack: false, canGoForward: false },
      actions,
      false,
    )
    expect(ids(edit)).toEqual([
      'undo',
      'redo',
      'separator',
      'cut',
      'copy',
      'paste',
      'pasteAndMatchStyle',
      'selectAll',
    ])
    const sel = pageMenuTemplate(
      { ...params, selectionText: ' rice ' },
      { canGoBack: false, canGoForward: false },
      actions,
      false,
    )
    expect(ids(sel)).toEqual(['copy', 'search-selection'])
  })
})

describe('protocol', () => {
  const root = '/app/out/renderer'

  it('maps tiger://ui paths inside the renderer folder and nothing else', () => {
    expect(resolveUiFile(root, 'tiger://ui/')).toBe(join(root, 'index.html'))
    expect(resolveUiFile(root, 'tiger://ui/assets/a.js?x=1')).toBe(join(root, 'assets/a.js'))
    expect(resolveUiFile(root, 'tiger://ui/../../etc/passwd')).toBe(join(root, 'etc/passwd'))
    expect(resolveUiFile(root, 'tiger://ui/%2e%2e/%2e%2e/etc/passwd')).toBe(
      join(root, 'etc/passwd'),
    )
    expect(resolveUiFile(root, 'tiger://ui/a%2f..%2f..%2f..%2fetc%2fpasswd')).toBeNull()
    expect(resolveUiFile(root, 'tiger://ui/a%00b')).toBeNull()
    expect(resolveUiFile(root, 'tiger://other/index.html')).toBeNull()
    expect(resolveUiFile(root, 'https://ui/index.html')).toBeNull()
  })

  it('the CSP forbids inline and remote script', () => {
    expect(UI_CSP).toContain("script-src 'self'")
    expect(UI_CSP).not.toMatch(/script-src[^;]*unsafe/)
    expect(UI_CSP).toContain("object-src 'none'")
  })

  it('the CSP lets the UI connect to the configured server and nothing else', () => {
    const csp = uiCsp('https://api.tiger.example/v1')
    const connect = csp.split('; ').find((d) => d.startsWith('connect-src'))
    expect(connect).toBe("connect-src 'self' https://api.tiger.example wss://api.tiger.example")
    expect(uiCsp('http://127.0.0.1:8787')).toContain(
      "connect-src 'self' http://127.0.0.1:8787 ws://127.0.0.1:8787;",
    )
    expect(uiCsp('javascript:alert(1)')).toContain("connect-src 'self';")
    expect(uiCsp(null)).toBe(UI_CSP)
    expect(csp).not.toMatch(/script-src[^;]*unsafe/)
  })
})

describe('small helpers', () => {
  it('file names cannot escape the folder', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd')
    expect(safeFileName('..\\..\\x.txt')).toBe('x.txt')
    expect(safeFileName('a<b>:c?.txt')).toBe('a_b__c_.txt')
    expect(safeFileName('...')).toBe('download')
    const taken = new Set(['/d/f.txt', '/d/f (1).txt'])
    expect(uniquePath('/d', 'f.txt', (p) => taken.has(p))).toBe('/d/f (2).txt')
  })

  it("the user agent has Chromium's shape", () => {
    const electron =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) tiger-browser/0.1.0 Chrome/156.0.8078.109 Electron/45.5.0 Safari/537.36'
    expect(chromeLikeUserAgent(electron)).toBe(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
    )
  })

  it('zoom steps along the ladder and clamps', () => {
    expect(nextZoom(1, 'in')).toBe(1.1)
    expect(nextZoom(1, 'out')).toBe(0.9)
    expect(nextZoom(5, 'in')).toBe(5)
    expect(nextZoom(0.25, 'out')).toBe(0.25)
    expect(nextZoom(1.05, 'in')).toBe(1.1)
  })
})

describe('invite links', () => {
  const TOKEN = 'AbC_def-1234567890xyz'
  it('recognises the server-issued link of the configured server only', () => {
    expect(
      inviteTokenFromUrl(`http://localhost:8787/invite#${TOKEN}`, 'http://localhost:8787'),
    ).toBe(TOKEN)
    expect(inviteTokenFromUrl(`https://t.example/invite/#${TOKEN}`, 'https://t.example/')).toBe(
      TOKEN,
    )
    expect(
      inviteTokenFromUrl(`https://t.example/api/invite#${TOKEN}`, 'https://t.example/api'),
    ).toBe(TOKEN)
    // Another origin, another path, no token, a non-token, or not a web URL: an ordinary navigation.
    expect(
      inviteTokenFromUrl(`https://evil.example/invite#${TOKEN}`, 'https://t.example'),
    ).toBeNull()
    expect(inviteTokenFromUrl(`http://t.example/invite#${TOKEN}`, 'https://t.example')).toBeNull()
    expect(inviteTokenFromUrl(`https://t.example/invites#${TOKEN}`, 'https://t.example')).toBeNull()
    expect(inviteTokenFromUrl('https://t.example/invite', 'https://t.example')).toBeNull()
    expect(inviteTokenFromUrl('https://t.example/invite#short', 'https://t.example')).toBeNull()
    expect(
      inviteTokenFromUrl('https://t.example/invite#a b c d e f g h', 'https://t.example'),
    ).toBeNull()
    expect(inviteTokenFromUrl(`tiger://ui/invite#${TOKEN}`, 'tiger://ui')).toBeNull()
    expect(inviteTokenFromUrl(`https://t.example/invite#${TOKEN}`, 'not a url')).toBeNull()
  })
})
