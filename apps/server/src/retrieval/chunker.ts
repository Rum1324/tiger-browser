/**
 * Markdown chunker for mixed Japanese and English text.
 *
 * Rules (evidence: docs/research/retrieval-jp.md, "Chunking Markdown with Japanese"):
 *  - one heading section at a time; sections are never merged, so a chunk has exactly one heading path
 *  - inside a section, sentences (。！？ and Latin sentence ends) and lines are packed up to about
 *    `targetChars`; no overlap
 *  - tables and fenced code blocks are atomic units and stay whole while they fit `maxBlockChars`;
 *    larger ones are split by row / line (a table keeps its header row in every piece)
 *  - every chunk also respects a token cap derived from the embedding model's window, so the
 *    embedder never silently truncates text that was stored for retrieval
 */

export interface Chunk {
  /** Position within the document, from 0, in reading order. */
  ord: number
  /** Heading titles from the top level down, joined by " > ". Empty before the first heading. */
  headingPath: string
  text: string
  charCount: number
}

export interface ChunkOptions {
  /** Document title; only used to reserve token room for the prefix the embedder adds. */
  title?: string
  /** Pack sentences up to about this many characters. */
  targetChars?: number
  /** Largest size for an atomic table or code block that is kept whole. */
  maxBlockChars?: number
  /** Hard cap on the estimated tokens of one chunk including its heading prefix. */
  maxTokens?: number
}

export const DEFAULT_TARGET_CHARS = 300
export const DEFAULT_MAX_BLOCK_CHARS = 1200
/** e5 accepts 512 tokens; the rest is slack for the estimator's error and the "passage: " prefix. */
export const DEFAULT_MAX_TOKENS = 440

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯가-힯]/

/**
 * Conservative token estimate for e5's SentencePiece vocabulary. Measured against the real tokenizer
 * (test/retrieval/e5.test.ts): Japanese prose 0.74 tokens per character, English prose 0.31, a
 * numeric table 0.63, code 0.44, and a run of one repeated kana up to 1.0. The weights are an upper
 * bound for each class so the cap holds for any mix.
 */
export function estimateTokens(text: string): number {
  let t = 0
  for (const ch of text) {
    if (CJK.test(ch)) t += 1
    else if (ch === ' ' || ch === '\n' || ch === '\t') t += 0.15
    else if (/[0-9]/.test(ch)) t += 0.8
    else if (/[A-Za-z]/.test(ch)) t += 0.4
    else t += 1
  }
  // 5% on top: the numeric-table and repeated-kana samples sit within a few tokens of their weights.
  return Math.ceil(t * 1.05)
}

interface Unit {
  text: string
  /** Whitespace that separated this unit from the previous one in the source. */
  gap: string
  atomic: boolean
}

interface Section {
  path: string
  units: Unit[]
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const TABLE_LINE = /^\s*\|/

export function chunkMarkdown(markdown: string, options: ChunkOptions = {}): Chunk[] {
  const targetChars = options.targetChars ?? DEFAULT_TARGET_CHARS
  const maxBlockChars = options.maxBlockChars ?? DEFAULT_MAX_BLOCK_CHARS
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS
  const titleTokens = options.title ? estimateTokens(options.title) + 2 : 0

  const chunks: Chunk[] = []
  for (const section of parseSections(markdown)) {
    const pathTokens = titleTokens + (section.path ? estimateTokens(section.path) + 2 : 0)
    const tokenBudget = Math.max(40, maxTokens - pathTokens)
    const fits = (s: string, chars: number) => s.length <= chars && estimateTokens(s) <= tokenBudget

    // Break oversized units down so every unit fits one chunk.
    const units: Unit[] = []
    for (const u of section.units) {
      if (u.atomic && fits(u.text, maxBlockChars)) units.push(u)
      else if (u.atomic) units.push(...splitBlock(u, maxBlockChars, tokenBudget))
      else units.push(...splitText(u, targetChars, tokenBudget))
    }

    let current = ''
    let currentAtomic = false
    const flush = () => {
      const text = current.trim()
      if (text) {
        chunks.push({
          ord: chunks.length,
          headingPath: section.path,
          text,
          charCount: text.length,
        })
      }
      current = ''
      currentAtomic = false
    }
    for (const u of units) {
      if (current === '') {
        current = u.text
        currentAtomic = u.atomic
        continue
      }
      const joined = current + u.gap + u.text
      let merge: boolean
      if (currentAtomic) merge = false
      else if (u.atomic) {
        // A short lead-in line ("The table below lists...") stays with its table.
        merge = current.length <= LEAD_IN_CHARS && joined.length <= maxBlockChars
      } else merge = joined.length <= targetChars
      if (merge && estimateTokens(joined) <= tokenBudget) {
        current = joined
        currentAtomic = currentAtomic || u.atomic
      } else {
        flush()
        current = u.text
        currentAtomic = u.atomic
      }
    }
    flush()
  }
  return chunks
}

const LEAD_IN_CHARS = 120

function parseSections(markdown: string): Section[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const sections: Section[] = []
  const stack: { level: number; title: string }[] = []
  let current: Section = { path: '', units: [] }
  let paragraph: string[] = []
  let blankBefore = false

  const pushUnit = (text: string, atomic: boolean) => {
    const first = current.units.length === 0
    const gap = first ? '' : blankBefore ? '\n\n' : '\n'
    current.units.push({ text, gap, atomic })
    blankBefore = false
  }
  const flushParagraph = () => {
    if (paragraph.length === 0) return
    // Each source line is a sentence boundary; Japanese and Latin sentence ends split further.
    paragraph.forEach((line, i) => {
      splitSentences(line).forEach((p, j) => {
        let gap: string
        if (current.units.length === 0) gap = ''
        else if (i === 0 && j === 0) gap = blankBefore ? '\n\n' : '\n'
        else if (j === 0) gap = '\n'
        else gap = p.gap
        current.units.push({ text: p.text, gap, atomic: false })
      })
    })
    paragraph = []
    blankBefore = false
  }
  const endSection = () => {
    flushParagraph()
    if (current.units.length > 0) sections.push(current)
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const fence = FENCE.exec(line)
    if (fence) {
      flushParagraph()
      const marker = fence[1] as string
      const block = [line]
      i++
      while (i < lines.length) {
        const l = lines[i] as string
        block.push(l)
        const close = FENCE.exec(l)
        if (
          close &&
          (close[1] as string)[0] === marker[0] &&
          (close[1] as string).length >= marker.length
        ) {
          break
        }
        i++
      }
      pushUnit(block.join('\n'), true)
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      endSection()
      const level = (heading[1] as string).length
      while (stack.length > 0 && (stack[stack.length - 1] as { level: number }).level >= level) {
        stack.pop()
      }
      stack.push({ level, title: heading[2] as string })
      current = { path: stack.map((s) => s.title).join(' > '), units: [] }
      blankBefore = false
      continue
    }
    if (TABLE_LINE.test(line)) {
      flushParagraph()
      const rows = [line]
      while (i + 1 < lines.length && TABLE_LINE.test(lines[i + 1] as string)) {
        i++
        rows.push(lines[i] as string)
      }
      pushUnit(rows.join('\n'), true)
      continue
    }
    if (line.trim() === '') {
      flushParagraph()
      blankBefore = true
      continue
    }
    paragraph.push(line.trim())
  }
  endSection()
  return sections
}

const SENTENCE_END = /[。！？!?]+[」』）)"'”’]*|[.](?=\s|$)[」』）)"'”’]*/g

/** Split one line into sentences, keeping the exact text and the whitespace between them. */
function splitSentences(line: string): { text: string; gap: string }[] {
  const out: { text: string; gap: string }[] = []
  let start = 0
  let gap = ''
  SENTENCE_END.lastIndex = 0
  for (let m = SENTENCE_END.exec(line); m; m = SENTENCE_END.exec(line)) {
    let end = m.index + m[0].length
    // "3.5" and "v1.2" never match (no whitespace after the dot); a decimal comma needs no handling.
    const ws = /^\s*/.exec(line.slice(end))?.[0] ?? ''
    const text = line.slice(start, end).trim()
    if (text) out.push({ text, gap })
    end += ws.length
    gap = ws
    start = end
    SENTENCE_END.lastIndex = end
  }
  const rest = line.slice(start).trim()
  if (rest) out.push({ text: rest, gap })
  return out
}

/** Hard-split one prose unit that alone is too large (a very long sentence). */
function splitText(u: Unit, targetChars: number, tokenBudget: number): Unit[] {
  if (u.text.length <= targetChars * 2 && estimateTokens(u.text) <= tokenBudget) return [u]
  const out: Unit[] = []
  let rest = u.text
  let gap = u.gap
  while (rest.length > 0) {
    let n = Math.min(rest.length, targetChars * 2)
    while (n > 1 && estimateTokens(rest.slice(0, n)) > tokenBudget) n = Math.floor(n * 0.8)
    // Prefer to cut after a Japanese comma or a space when one is close to the limit.
    if (n < rest.length) {
      const window = rest.slice(Math.floor(n * 0.6), n)
      const cut = Math.max(
        window.lastIndexOf('、'),
        window.lastIndexOf(' '),
        window.lastIndexOf(','),
      )
      if (cut >= 0) n = Math.floor(n * 0.6) + cut + 1
    }
    out.push({ text: rest.slice(0, n).trim(), gap, atomic: false })
    rest = rest.slice(n)
    gap = ''
  }
  return out.filter((x) => x.text !== '')
}

/**
 * Split an atomic block that is too large: a table by rows with its header repeated, code by lines.
 * Pieces stay atomic so they are not glued to prose.
 */
function splitBlock(u: Unit, maxBlockChars: number, tokenBudget: number): Unit[] {
  const lines = u.text.split('\n')
  const isTable = TABLE_LINE.test(lines[0] ?? '')
  const head: string[] = []
  if (isTable) {
    // Header row plus the |---| separator.
    const sepAt = lines.findIndex((l) => /^\s*\|[\s:|-]+\|?\s*$/.test(l))
    if (sepAt === 1) head.push(lines[0] as string, lines[1] as string)
  }
  const fenceOpen = isTable ? '' : (lines[0] ?? '')
  const closes = !isTable && lines.length > 1 && FENCE.test(lines[lines.length - 1] as string)
  const body = isTable
    ? lines.slice(head.length)
    : lines.slice(1, closes ? lines.length - 1 : lines.length)
  const prefix = isTable ? head : [fenceOpen]
  const suffix = isTable ? [] : [closes ? (lines[lines.length - 1] as string) : '```']

  const out: Unit[] = []
  let piece: string[] = []
  const render = (rows: string[]) => [...prefix, ...rows, ...suffix].join('\n')
  const fitsPiece = (rows: string[]) => {
    const r = render(rows)
    return r.length <= maxBlockChars && estimateTokens(r) <= tokenBudget
  }
  for (const row of body) {
    if (piece.length > 0 && !fitsPiece([...piece, row])) {
      out.push({ text: render(piece), gap: out.length === 0 ? u.gap : '\n\n', atomic: true })
      piece = []
    }
    if (piece.length === 0 && !fitsPiece([row])) {
      // A single row that is too long: cut it on characters.
      const room = Math.max(20, Math.min(maxBlockChars, tokenBudget) - render([]).length)
      for (let p = 0; p < row.length; p += room) {
        out.push({
          text: render([row.slice(p, p + room)]),
          gap: out.length === 0 ? u.gap : '\n\n',
          atomic: true,
        })
      }
      continue
    }
    piece.push(row)
  }
  if (piece.length > 0) {
    out.push({ text: render(piece), gap: out.length === 0 ? u.gap : '\n\n', atomic: true })
  }
  return out
}
