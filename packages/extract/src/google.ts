import { resolveLang } from './lang'
import { clip, collapseSpaces, normalizeNewlines, tidyMarkdown } from './text'
import type { Extraction } from './types'

/**
 * Google Docs, Sheets and Slides draw their content to canvas, so the DOM has no document text. The
 * engine fetches the export URLs planned here with the member's own session cookies and hands the
 * bodies back. Shapes verified unauthenticated on public files (docs/research/google-export-oauth.md);
 * the export path is undocumented and can change.
 */

export type GoogleKind = 'google-doc' | 'google-sheet' | 'google-slides'

export interface GoogleExportRequest {
  url: string
  format: 'md' | 'csv' | 'txt'
}

export interface GoogleExportPlan {
  kind: GoogleKind
  fileId: string
  /** Sheets only: the tab being viewed. Null exports the first tab. */
  gid: string | null
  requests: GoogleExportRequest[]
}

export interface GoogleExportResponse {
  status: number
  contentType: string | null
  body: string
  /** URL after redirects, when the engine knows it. A landing on accounts.google.com is a sign-in page. */
  finalUrl?: string | null
}

export interface GoogleExportMeta {
  /** The tab title, e.g. `Plan - Google Docs`; the product suffix is removed. */
  title?: string | null
  lang?: string | null
}

const EDITOR = /^\/(document|spreadsheets|presentation)\/(?:u\/(\d+)\/)?d\/([A-Za-z0-9_-]+)/

const KIND: Record<string, GoogleKind> = {
  document: 'google-doc',
  spreadsheets: 'google-sheet',
  presentation: 'google-slides',
}

export function planGoogleExport(rawUrl: string): GoogleExportPlan | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'docs.google.com') return null
  const m = EDITOR.exec(url.pathname)
  if (!m) return null
  const [, app, userIndex, fileId] = m as unknown as [string, string, string | undefined, string]
  // `/d/e/<id>/pub` is a published-to-web page: ordinary HTML, handled by DOM extraction.
  if (fileId === 'e') return null
  const kind = KIND[app] as GoogleKind
  const authuser = userIndex ?? url.searchParams.get('authuser')
  const authParam = authuser && /^\d+$/.test(authuser) ? `authuser=${authuser}` : null
  const base = `https://docs.google.com/${app}/d/${fileId}`

  if (kind === 'google-doc') {
    return {
      kind,
      fileId,
      gid: null,
      requests: [{ url: withQuery(`${base}/export`, ['format=md', authParam]), format: 'md' }],
    }
  }
  if (kind === 'google-sheet') {
    const gid = sheetGid(url)
    return {
      kind,
      fileId,
      gid,
      requests: [
        {
          url: withQuery(`${base}/export`, ['format=csv', gid ? `gid=${gid}` : null, authParam]),
          format: 'csv',
        },
      ],
    }
  }
  return {
    kind,
    fileId,
    gid: null,
    requests: [{ url: withQuery(`${base}/export/txt`, [authParam]), format: 'txt' }],
  }
}

function withQuery(base: string, params: (string | null)[]): string {
  const q = params.filter((p): p is string => p !== null)
  return q.length ? `${base}?${q.join('&')}` : base
}

function sheetGid(url: URL): string | null {
  const fromHash = /(?:^#|[#&])gid=(\d+)/.exec(url.hash)
  if (fromHash?.[1]) return fromHash[1]
  const fromQuery = url.searchParams.get('gid')
  return fromQuery && /^\d+$/.test(fromQuery) ? fromQuery : null
}

/**
 * True when a response is not an export: an error status, an HTML page (Google's sign-in, "request
 * access" and error pages are HTML served with status 200), or a redirect that ended on the sign-in host.
 */
export function isNotAnExport(res: GoogleExportResponse): boolean {
  if (res.status < 200 || res.status > 299) return true
  if (res.contentType && /text\/html|application\/xhtml/i.test(res.contentType)) return true
  if (res.finalUrl) {
    try {
      if (new URL(res.finalUrl).hostname === 'accounts.google.com') return true
    } catch {
      return true
    }
  }
  const head = res.body
    .replace(/^\ufeff/, '')
    .trimStart()
    .slice(0, 512)
    .toLowerCase()
  return head.startsWith('<!doctype html') || head.startsWith('<html') || /<head[\s>]/.test(head)
}

const SUFFIX = / - Google (Docs|Sheets|Slides|ドキュメント|スプレッドシート|スライド)$/

function cleanTitle(meta: GoogleExportMeta, fallback: string): string {
  const t = collapseSpaces(meta.title ?? '').replace(SUFFIX, '')
  return clip(t || fallback, 500)
}

export function fromGoogleExport(
  plan: GoogleExportPlan,
  responses: GoogleExportResponse[],
  meta: GoogleExportMeta = {},
): Extraction | null {
  const res = responses[0]
  if (!res || responses.some(isNotAnExport)) return null
  const body = normalizeNewlines(res.body)

  let markdown: string
  let extractor: string
  let fallbackTitle: string
  if (plan.kind === 'google-doc') {
    markdown = normalizeDocsMarkdown(body)
    extractor = 'google-docs-export@1'
    fallbackTitle = /^#{1,6}\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? 'Untitled document'
  } else if (plan.kind === 'google-sheet') {
    markdown = csvToMarkdownTable(body)
    extractor = 'google-sheets-export@1'
    fallbackTitle = 'Untitled spreadsheet'
  } else {
    markdown = slidesText(body)
    extractor = 'google-slides-export@1'
    fallbackTitle = markdown.split('\n')[0]?.trim() || 'Untitled presentation'
  }
  markdown = tidyMarkdown(markdown)
  if (!markdown) return null
  return {
    title: cleanTitle(meta, fallbackTitle),
    markdown,
    lang: resolveLang(meta.lang ?? null, markdown),
    byline: null,
    siteName:
      plan.kind === 'google-doc'
        ? 'Google Docs'
        : plan.kind === 'google-sheet'
          ? 'Google Sheets'
          : 'Google Slides',
    extractor,
  }
}

// ── Docs ────────────────────────────────────────────────────────────────────

/**
 * Google's Markdown export escapes characters that need no escaping (`\-`, `\.`, `\!`), bolds whole
 * headings, and embeds images as base64 reference definitions. Undo the noise; keep escapes that
 * would otherwise change the structure (a list marker or heading at the start of a line).
 */
export function normalizeDocsMarkdown(md: string): string {
  const out: string[] = []
  let fence: string | null = null
  const dataRefs = new Set<string>()
  for (const line of md.split('\n')) {
    const def = /^\s*\[([^\]]+)\]:\s*<?data:/i.exec(line)
    if (def?.[1]) dataRefs.add(def[1].toLowerCase())
  }
  for (const line of md.split('\n')) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fenceMatch?.[1]) {
      if (fence === null) fence = fenceMatch[1]
      else if (fenceMatch[1].startsWith(fence[0] as string) && fenceMatch[1].length >= fence.length)
        fence = null
      out.push(line)
      continue
    }
    if (fence !== null) {
      out.push(line)
      continue
    }
    if (/^\s*\[[^\]]+\]:\s*<?data:/i.test(line)) continue
    let l = line
      .replace(/!\[([^\]]*)\]\[([^\]]+)\]/g, (whole, alt: string, ref: string) =>
        dataRefs.has(ref.toLowerCase()) ? (alt ? `![${alt}]` : '') : whole,
      )
      .replace(/!\[([^\]]*)\]\(\s*<?data:[^)]*\)/gi, (_w, alt: string) => (alt ? `![${alt}]` : ''))
    l = unescapeLine(l)
    l = l.replace(/^(#{1,6}\s+)\*\*(.+)\*\*\s*$/, '$1$2')
    out.push(l)
  }
  return out.join('\n')
}

function unescapeLine(line: string): string {
  const lead = /^(\s*)(\\[-+#>=])/.exec(line)
  // Escapes at the very start of a line can be structural; keep the first one and unescape the rest.
  const keepPrefix = lead ? (lead[1] ?? '') + (lead[2] ?? '') : ''
  let rest = line.slice(keepPrefix.length)
  const orderedLead = keepPrefix ? null : /^(\s*\d+)\\\./.exec(rest)
  let orderedPrefix = ''
  if (orderedLead) {
    orderedPrefix = `${orderedLead[0]}`
    rest = rest.slice(orderedPrefix.length)
  }
  rest = rest
    .replace(/\\([-.=+#>%])/g, '$1')
    .replace(/\\!(?!\[)/g, '!')
    .replace(/(?<!\])\\([()])/g, '$1')
  return keepPrefix + orderedPrefix + rest
}

// ── Sheets ──────────────────────────────────────────────────────────────────

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"' && field === '') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export function csvToMarkdownTable(csv: string): string {
  const rows = parseCsv(csv)
  // Sheets exports the used range, which often ends in blank rows and columns.
  while (rows.length && (rows[rows.length - 1] as string[]).every((c) => c.trim() === ''))
    rows.pop()
  if (rows.length === 0) return ''
  let cols = 0
  for (const r of rows) {
    for (let c = r.length - 1; c >= 0; c--) {
      if ((r[c] as string).trim() !== '') {
        cols = Math.max(cols, c + 1)
        break
      }
    }
  }
  if (cols === 0) return ''
  const cell = (v: string | undefined) =>
    (v ?? '').trim().replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n+/g, '<br>')
  const line = (r: string[]) =>
    `| ${Array.from({ length: cols }, (_, i) => cell(r[i])).join(' | ')} |`
  const [header, ...body] = rows
  return [
    line(header as string[]),
    `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`,
    ...body.map(line),
  ].join('\n')
}

// ── Slides ──────────────────────────────────────────────────────────────────

function slidesText(txt: string): string {
  const slides = txt.split('\f')
  const clean = (s: string) =>
    s
      .split('\n')
      .map((l) => l.replace(/[ \t]+$/, ''))
      .join('\n')
      .trim()
  if (slides.length <= 1) return clean(txt)
  return slides
    .map(clean)
    .map((s, i) => (s ? `## Slide ${i + 1}\n\n${s}` : ''))
    .filter(Boolean)
    .join('\n\n')
}
