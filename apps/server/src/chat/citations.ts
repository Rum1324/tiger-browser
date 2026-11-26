import type { ContextSource } from '../retrieval/context'
import type { CitationInput } from '../seams'

/** Upper bound on a stored quote; the contract allows 600. */
export const MAX_QUOTE_CHARS = 300

const DIGIT = '[0-9０-９]'
const TOKEN = `[AＡ]?${DIGIT}{1,3}(?:\\s*[-–—~〜－]\\s*${DIGIT}{1,3})?`
const SEP = '\\s*[,、，]\\s*'
/**
 * One marker group: `[1]`, `[1, 3]`, `[A1]`, ranges `[1-3]`, full-width `［２］` and lenticular `【2】`
 * brackets. Not followed by `(` so Markdown link text like `[1](url)` is left alone.
 */
const MARKER = new RegExp(
  `([ \\t]*)[[［【]\\s*(${TOKEN}(?:${SEP}${TOKEN})*)\\s*[\\]］】](?!\\()([ \\t]*)`,
  'g',
)
/**
 * Copied through untouched: fenced blocks and inline code (array indexes look like markers), bare
 * URLs and Markdown link targets (`?ids[5]=`, `/page[7]`).
 */
const PROTECTED =
  /```[\s\S]*?(?:```|$)|`[^`\n]*`|\]\((?:[^()\s]|\([^()\s]*\))*\)|https?:\/\/[^\s<>()\u3000-\u30ff\u4e00-\u9fff\uff01-\uff60]+/g
/**
 * An ASCII bracket right after a Latin letter or digit is an index (`data[12]`), not a marker.
 * Full-width and lenticular brackets never index anything, so they stay markers there too.
 */
const INDEX_BEFORE = /[\p{L}\p{N}_]/u
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
/** Longest range a marker may expand to; `[1-300]` is not a citation. */
const MAX_RANGE = 10

export interface FinalAnswer {
  /** The answer text with markers to unknown sources removed and valid ones normalised to `[n]`. */
  content: string
  /** One citation per cited Space source, in order of first appearance. */
  citations: CitationInput[]
  /** Private page labels the answer cites (kept as `[A1]` text; never turned into citations). */
  privateLabels: string[]
}

function splitCode(text: string): { text: string; code: boolean }[] {
  const parts: { text: string; code: boolean }[] = []
  let last = 0
  for (const m of text.matchAll(PROTECTED)) {
    const at = m.index ?? 0
    if (at > last) parts.push({ text: text.slice(last, at), code: false })
    parts.push({ text: m[0], code: true })
    last = at + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), code: false })
  return parts
}

/** True when an ASCII-bracket match at `offset` directly follows a Latin word character. */
function isIndex(
  match: string,
  lead: string,
  offset: number,
  all: string,
  before: string,
): boolean {
  if (lead || !match.startsWith('[')) return false
  const prev = offset > 0 ? [...all.slice(0, offset)].at(-1) : [...before].at(-1)
  return prev !== undefined && INDEX_BEFORE.test(prev) && !CJK.test(prev)
}

/** The tokens of one marker group, NFKC-normalised, ranges expanded: `１-３` → 1, 2, 3. */
export function markerTokens(group: string): string[] {
  const out: string[] = []
  for (const raw of group.normalize('NFKC').split(/\s*[,、，]\s*/)) {
    const range = /^(\d{1,3})\s*[-–—~〜]\s*(\d{1,3})$/.exec(raw)
    if (range) {
      const from = Number(range[1])
      const to = Number(range[2])
      if (to < from || to - from >= MAX_RANGE) continue
      for (let n = from; n <= to; n++) out.push(String(n))
      continue
    }
    if (/^A?\d{1,3}$/.test(raw)) out.push(raw)
  }
  return out
}

/** Rewrites marker groups, keeping only known numbers and labels. */
export function cleanMarkers(
  text: string,
  validNumbers: Set<number>,
  validLabels: Set<string>,
): string {
  let before = ''
  return splitCode(text)
    .map((part) => {
      const prefix = before
      before = part.text
      if (part.code) return part.text
      return part.text.replace(
        MARKER,
        (m: string, lead: string, group: string, trail: string, offset: number, all: string) => {
          if (isIndex(m, lead, offset, all, prefix)) return m
          const kept = markerTokens(group).filter((tok) =>
            tok.startsWith('A') ? validLabels.has(tok) : validNumbers.has(Number(tok)),
          )
          const unique = [...new Set(kept)]
          if (unique.length > 0) return `${lead}${unique.map((t) => `[${t}]`).join('')}${trail}`
          // Removing a marker must not leave a line indented or two spaces in a row.
          if (offset === 0 || all[offset - 1] === '\n') return ''
          return lead && trail ? ' ' : lead ? '' : trail
        },
      )
    })
    .join('')
}

/**
 * Citation markers of an earlier answer point at an older numbering; drop them from history text.
 * Code, URLs and Markdown link text are kept.
 */
export function stripCitationMarkers(text: string): string {
  return splitCode(text)
    .map((part) =>
      part.code
        ? part.text
        : part.text.replace(MARKER, (m: string, _lead: string, group: string, trail: string) =>
            markerTokens(group).length > 0 ? trail : m,
          ),
    )
    .join('')
}

/** Lowercased letters and digits only, so bigrams compare content, not punctuation or spacing. */
function normalise(s: string): string {
  return s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function bigrams(s: string): Map<string, number> {
  const n = normalise(s)
  const out = new Map<string, number>()
  const chars = [...n]
  for (let i = 0; i < chars.length - 1; i++) {
    const g = `${chars[i]}${chars[i + 1]}`
    out.set(g, (out.get(g) ?? 0) + 1)
  }
  return out
}

/** Cosine similarity of character bigram counts: works for Japanese (no spaces) and English alike. */
export function similarity(a: string, b: string): number {
  const ga = bigrams(a)
  const gb = bigrams(b)
  let dot = 0
  let na = 0
  let nb = 0
  for (const [g, c] of ga) {
    na += c * c
    dot += c * (gb.get(g) ?? 0)
  }
  for (const c of gb.values()) nb += c * c
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb)
}

/** Sentence-sized pieces of a source, without Markdown heading and list syntax. */
export function sourceSegments(text: string): string[] {
  return text
    .split(/\n+|(?<=[。．！？!?])|(?<=\.)\s+/)
    .map((s) =>
      s
        .replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((s) => normalise(s).length >= 4 && s !== '…')
}

export function boundQuote(s: string, max = MAX_QUOTE_CHARS): string {
  const chars = [...s]
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join('')}…`
}

/** The source segment that best supports `claims`; the first segment when nothing overlaps. */
export function bestQuote(source: Pick<ContextSource, 'text'>, claims: string[]): string {
  const segments = sourceSegments(source.text)
  if (segments.length === 0) return ''
  let best = segments[0] as string
  let bestScore = 0
  for (const seg of segments) {
    for (const claim of claims) {
      const score = similarity(seg, claim)
      if (score > bestScore) {
        bestScore = score
        best = seg
      }
    }
  }
  return boundQuote(best)
}

/** The answer sentence a marker belongs to: back to the previous sentence end, markers removed. */
function claimBefore(text: string, markerAt: number): string {
  const before = text.slice(0, markerAt)
  const cut = Math.max(
    before.lastIndexOf('\n'),
    ...['。', '！', '？', '. ', '! ', '? '].map((p) => {
      // A boundary right before the marker ends this claim, not the previous one.
      const i = before.trimEnd().slice(0, -1).lastIndexOf(p)
      return i < 0 ? -1 : i + p.length - 1
    }),
  )
  return before
    .slice(cut + 1)
    .replace(MARKER, ' ')
    .trim()
}

export function sourceToCitation(s: ContextSource, quote: string): CitationInput {
  return {
    n: s.n,
    itemId: s.itemId,
    itemVersionId: s.itemVersionId,
    title: s.title,
    url: s.url,
    sourceType: s.sourceType,
    sharedBy: s.sharedBy,
    sharedAt: s.sharedAt,
    quote,
  }
}

/** Early source list for the UI: every source, its opening as a placeholder quote. */
export function previewCitations(sources: ContextSource[]): CitationInput[] {
  return sources.map((s) => sourceToCitation(s, boundQuote(sourceSegments(s.text)[0] ?? '', 200)))
}

/**
 * Validate the markers of a finished answer against the sources that were in the prompt and build
 * one citation per cited source with the passage that best supports the cited sentences.
 */
export function finalizeAnswer(
  text: string,
  sources: ContextSource[],
  privateLabels: string[],
): FinalAnswer {
  const byN = new Map(sources.map((s) => [s.n, s]))
  const labels = new Set(privateLabels)
  const content = cleanMarkers(text, new Set(byN.keys()), labels)

  const claims = new Map<number, string[]>()
  const order: number[] = []
  const usedLabels: string[] = []
  let before = ''
  for (const part of splitCode(content)) {
    const prefix = before
    before = part.text
    if (part.code) continue
    for (const m of part.text.matchAll(MARKER)) {
      if (isIndex(m[0], m[1] ?? '', m.index ?? 0, part.text, prefix)) continue
      const claim = claimBefore(part.text, m.index ?? 0)
      for (const tok of markerTokens(m[2] ?? '')) {
        if (tok.startsWith('A')) {
          if (!usedLabels.includes(tok)) usedLabels.push(tok)
          continue
        }
        const n = Number(tok)
        if (!claims.has(n)) {
          claims.set(n, [])
          order.push(n)
        }
        if (claim) claims.get(n)?.push(claim)
      }
    }
  }
  const citations = order.flatMap((n) => {
    const s = byN.get(n)
    return s ? [sourceToCitation(s, bestQuote(s, claims.get(n) ?? []))] : []
  })
  return { content, citations, privateLabels: usedLabels }
}
