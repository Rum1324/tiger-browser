import type { PdfResult } from '@tiger/extract/pdf'
import { describe, expect, it, vi } from 'vitest'
import {
  type CaptureDeps,
  type CaptureTarget,
  captureTab,
  type DomReply,
  type FetchedResource,
} from '../../src/main/capture'

const extraction = {
  title: 'Notes',
  markdown: '# Notes\n\nHello world.',
  lang: 'en',
  byline: null,
  siteName: null,
  extractor: 'readability@0.6',
}

function setup(
  url: string,
  opts: { isPrivate?: boolean; blocked?: string[]; dom?: DomReply } = {},
) {
  let current = url
  const target: CaptureTarget = {
    currentUrl: () => current,
    title: () => 'Tab title - Google Docs',
    isPrivate: opts.isPrivate ?? false,
  }
  const fetched: string[] = []
  const deps = {
    userBlockedHosts: () => opts.blocked ?? [],
    now: () => new Date('2026-11-26T00:00:00Z'),
    extractDom: vi.fn(
      async (): Promise<DomReply> => opts.dom ?? { kind: 'dom', url: current, extraction },
    ),
    fetchWithTabSession: vi.fn(async (u: string, _mode: string): Promise<FetchedResource> => {
      fetched.push(u)
      return {
        status: 200,
        contentType: 'text/markdown',
        finalUrl: u,
        body: new TextEncoder().encode('# Doc\n\nBody text'),
      }
    }),
    extractPdf: vi.fn(
      async (): Promise<PdfResult> => ({
        extraction: { ...extraction, extractor: 'pdfjs@6.5.438' },
        pageCount: 1,
      }),
    ),
  } satisfies CaptureDeps
  return {
    target,
    deps,
    fetched,
    navigate: (u: string) => {
      current = u
    },
  }
}

describe('captureTab: eligibility is decided here', () => {
  it('refuses a private tab without touching the page', async () => {
    const { target, deps } = setup('https://example.com/a', { isPrivate: true })
    const r = await captureTab(target, deps)
    expect(r).toMatchObject({ ok: false, error: 'blocked', reason: 'incognito' })
    expect(deps.extractDom).not.toHaveBeenCalled()
    expect(deps.fetchWithTabSession).not.toHaveBeenCalled()
  })

  it('refuses a blocklisted host', async () => {
    const { target, deps } = setup('https://direct.bk.mufg.jp/login')
    const r = await captureTab(target, deps)
    expect(r).toMatchObject({ ok: false, error: 'blocked', reason: 'banking' })
    expect(deps.extractDom).not.toHaveBeenCalled()
  })

  it("refuses a host on the member's own blocklist", async () => {
    const { target, deps } = setup('https://wiki.corp.example/page', { blocked: ['corp.example'] })
    const r = await captureTab(target, deps)
    expect(r).toMatchObject({ ok: false, error: 'blocked', reason: 'user-rule' })
  })

  it('refuses non-web schemes', async () => {
    const { target, deps } = setup('about:blank')
    expect(await captureTab(target, deps)).toMatchObject({
      ok: false,
      error: 'blocked',
      reason: 'scheme',
    })
  })

  it('refuses when the tab navigated to a blocked page during extraction', async () => {
    const s = setup('https://example.com/a')
    s.deps.extractDom.mockImplementation(async () => {
      s.navigate('https://mail.google.com/mail/u/0/')
      return { kind: 'dom', url: 'https://example.com/a', extraction }
    })
    const r = await captureTab(s.target, s.deps)
    expect(r).toMatchObject({ ok: false, error: 'blocked', reason: 'email' })
  })

  it('fails (without content) when the tab navigated to another allowed page meanwhile', async () => {
    const s = setup('https://example.com/a')
    s.deps.extractDom.mockImplementation(async () => {
      s.navigate('https://example.com/b')
      return { kind: 'dom', url: 'https://example.com/a', extraction }
    })
    expect(await captureTab(s.target, s.deps)).toMatchObject({ ok: false, error: 'failed' })
  })
})

describe('captureTab: extraction paths', () => {
  it('returns a finalized page from the DOM extractor', async () => {
    const { target, deps } = setup('https://example.com/a?utm_source=x')
    const r = await captureTab(target, deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.page).toMatchObject({
      url: 'https://example.com/a?utm_source=x',
      title: 'Notes',
      markdown: '# Notes\n\nHello world.',
      sourceType: 'web',
      capturedAt: '2026-11-26T00:00:00.000Z',
    })
    expect(deps.fetchWithTabSession).not.toHaveBeenCalled()
  })

  it('maps an empty extraction and an extractor error', async () => {
    const empty = setup('https://example.com/a', {
      dom: { kind: 'dom', url: 'https://example.com/a', extraction: null },
    })
    expect(await captureTab(empty.target, empty.deps)).toMatchObject({ ok: false, error: 'empty' })
    const err = setup('https://example.com/a', {
      dom: { kind: 'error', url: 'https://example.com/a', message: 'boom' },
    })
    expect(await captureTab(err.target, err.deps)).toMatchObject({
      ok: false,
      error: 'failed',
      detail: 'boom',
    })
  })

  it('reads Google Docs through the export URL with the tab session, never the DOM', async () => {
    const { target, deps, fetched } = setup('https://docs.google.com/document/d/abc123/edit')
    const r = await captureTab(target, deps)
    expect(fetched).toEqual(['https://docs.google.com/document/d/abc123/export?format=md'])
    expect(deps.fetchWithTabSession).toHaveBeenCalledWith(fetched[0], 'export')
    expect(deps.extractDom).not.toHaveBeenCalled()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.page).toMatchObject({ sourceType: 'google-doc', title: 'Tab title' })
  })

  it('never falls back to the canvas editor DOM when the Google export is refused', async () => {
    const s = setup('https://docs.google.com/document/d/abc123/edit')
    s.deps.fetchWithTabSession.mockResolvedValue({
      status: 200,
      contentType: 'text/html',
      finalUrl: 'https://accounts.google.com/signin',
      body: new TextEncoder().encode('<html>sign in</html>'),
    })
    expect(await captureTab(s.target, s.deps)).toEqual({
      ok: false,
      error: 'failed',
      reason: null,
      detail: 'google-export: not signed in to this account',
    })
    s.deps.fetchWithTabSession.mockResolvedValue({
      status: 403,
      contentType: 'text/html',
      finalUrl: 'https://docs.google.com/document/d/abc123/export?format=md',
      body: new TextEncoder().encode('<html>no</html>'),
    })
    expect(await captureTab(s.target, s.deps)).toMatchObject({
      ok: false,
      error: 'failed',
      detail: expect.stringMatching(/HTTP 403.*disabled/),
    })
    expect(s.deps.extractDom).not.toHaveBeenCalled()
  })

  it('refuses a Google export that was redirected to a blocked host', async () => {
    const s = setup('https://docs.google.com/document/d/abc123/edit')
    s.deps.fetchWithTabSession.mockResolvedValue({
      status: 200,
      contentType: 'text/markdown',
      finalUrl: 'https://direct.bk.mufg.jp/statement.md',
      body: new TextEncoder().encode('# Statement\n\nBalance'),
    })
    expect(await captureTab(s.target, s.deps)).toMatchObject({
      ok: false,
      error: 'blocked',
      reason: 'banking',
    })
  })

  it('refuses a PDF re-read that ended anywhere but the displayed URL', async () => {
    const s = setup('https://files.example/q3.pdf', {
      dom: { kind: 'pdf', url: 'https://files.example/q3.pdf' },
    })
    s.deps.fetchWithTabSession.mockResolvedValue({
      status: 200,
      contentType: 'application/pdf',
      finalUrl: 'https://direct.bk.mufg.jp/statements/latest.pdf',
      body: new Uint8Array([1]),
    })
    expect(await captureTab(s.target, s.deps)).toMatchObject({
      ok: false,
      error: 'blocked',
      reason: 'banking',
    })
    s.deps.fetchWithTabSession.mockResolvedValue({
      status: 200,
      contentType: 'application/pdf',
      finalUrl: 'https://other.example/x.pdf',
      body: new Uint8Array([1]),
    })
    expect(await captureTab(s.target, s.deps)).toMatchObject({ ok: false, error: 'failed' })
    expect(s.deps.extractPdf).not.toHaveBeenCalled()
  })

  it('reads a PDF through the tab session and pdf.js', async () => {
    const s = setup('https://example.com/report.pdf', {
      dom: { kind: 'pdf', url: 'https://example.com/report.pdf' },
    })
    s.deps.fetchWithTabSession.mockResolvedValue({
      status: 200,
      contentType: 'application/pdf',
      finalUrl: null,
      body: new Uint8Array([1]),
    })
    const r = await captureTab(s.target, s.deps)
    expect(s.fetched).toEqual([])
    expect(s.deps.fetchWithTabSession).toHaveBeenCalledWith(
      'https://example.com/report.pdf',
      'displayed-copy',
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.page.sourceType).toBe('pdf')
  })

  it('maps a PDF without a text layer to no-text-layer', async () => {
    const s = setup('https://example.com/scan.pdf', {
      dom: { kind: 'pdf', url: 'https://example.com/scan.pdf' },
    })
    s.deps.fetchWithTabSession.mockResolvedValue({
      status: 200,
      contentType: 'application/pdf',
      finalUrl: null,
      body: new Uint8Array([1]),
    })
    s.deps.extractPdf.mockResolvedValue({
      extraction: null,
      reason: 'no-text-layer',
      detail: '3 pages, no text',
      pageCount: 3,
    })
    expect(await captureTab(s.target, s.deps)).toEqual({
      ok: false,
      error: 'no-text-layer',
      reason: null,
      detail: '3 pages, no text',
    })
    s.deps.extractPdf.mockResolvedValue({
      extraction: null,
      reason: 'encrypted',
      detail: 'password',
      pageCount: null,
    })
    expect(await captureTab(s.target, s.deps)).toMatchObject({ ok: false, error: 'failed' })
  })

  it('reports a failed PDF fetch', async () => {
    const s = setup('https://example.com/r.pdf', {
      dom: { kind: 'pdf', url: 'https://example.com/r.pdf' },
    })
    s.deps.fetchWithTabSession.mockResolvedValue({
      status: 403,
      contentType: 'text/plain',
      finalUrl: null,
      body: new Uint8Array(),
    })
    expect(await captureTab(s.target, s.deps)).toMatchObject({
      ok: false,
      error: 'failed',
      detail: 'HTTP 403',
    })
  })
})
