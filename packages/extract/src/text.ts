/**
 * Character classes for East Asian text. A line break in HTML source between two such characters is
 * not a word gap (CSS Text 3, segment break transformation), so it must not become a space.
 */
const CJK =
  /[\u1100-\u11ff\u2e80-\u2fdf\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u3100-\u312f\u3130-\u318f\u31f0-\u31ff\u3200-\u32ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/

export function isCjk(ch: string | undefined): boolean {
  return ch !== undefined && CJK.test(ch)
}

/** Hangul keeps real spaces between words, so a segment break between Hangul syllables stays a space. */
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/

/** True when a source line break between `a` and `b` should vanish rather than become a space. */
export function dropsSegmentBreak(a: string | undefined, b: string | undefined): boolean {
  if (!isCjk(a) || !isCjk(b)) return false
  return !(HANGUL.test(a as string) && HANGUL.test(b as string))
}

/** Normalise line endings and strip a leading byte-order mark. */
export function normalizeNewlines(s: string): string {
  return s.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n')
}

/** Collapse three or more newlines to two and trim the ends. */
export function tidyMarkdown(s: string): string {
  return s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Cut a string to at most `max` UTF-16 units without splitting a surrogate pair. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s
  let end = max
  const code = s.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return s.slice(0, end)
}

/**
 * Collapse HTML whitespace only. JavaScript's `\s` also matches the ideographic space U+3000, which
 * Japanese text uses deliberately and must keep as written.
 */
export function collapseSpaces(s: string): string {
  return s.replace(/[ \t\n\r\f\u00a0]+/g, ' ').replace(/^ | $/g, '')
}
