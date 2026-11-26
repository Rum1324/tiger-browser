/**
 * Language of a page: the declared tag when it is plausible, otherwise a script-based guess from the
 * text. Japanese sites built from English templates often ship `<html lang="en">`; when the text is
 * unmistakably CJK, the text wins over the declaration.
 */

const TAG = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i

export function normalizeLangTag(raw: string | null | undefined): string | null {
  if (!raw) return null
  const tag =
    raw
      .trim()
      .replace(/_/g, '-')
      .split(/[,;\s]/)[0] ?? ''
  if (!TAG.test(tag) || tag.length > 16) return null
  const lower = tag.toLowerCase()
  if (lower === 'und' || lower === 'mul' || lower === 'zxx') return null
  const [primary, ...rest] = tag.split('-')
  return [primary?.toLowerCase(), ...rest.map((r) => (r.length === 2 ? r.toUpperCase() : r))].join(
    '-',
  )
}

export function declaredLang(doc: Document): string | null {
  const html = doc.documentElement
  const candidates = [
    html?.getAttribute('lang'),
    html?.getAttribute('xml:lang'),
    doc.querySelector('meta[http-equiv="content-language" i]')?.getAttribute('content'),
    doc.querySelector('meta[property="og:locale"]')?.getAttribute('content'),
  ]
  for (const c of candidates) {
    const tag = normalizeLangTag(c)
    if (tag) return tag
  }
  return null
}

const KANA = /[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff\uff66-\uff9f]/g
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g
const LATIN = /[A-Za-z\u00c0-\u024f]/g
const CYRILLIC = /[\u0400-\u04ff]/g
const ARABIC = /[\u0600-\u06ff]/g
const THAI = /[\u0e00-\u0e7f]/g
const EN_STOPWORDS = new Set([
  'the',
  'and',
  'of',
  'to',
  'in',
  'is',
  'that',
  'for',
  'it',
  'with',
  'as',
  'was',
  'on',
  'are',
  'be',
  'this',
  'by',
  'from',
  'at',
  'or',
])

function count(text: string, re: RegExp): number {
  return text.match(re)?.length ?? 0
}

/** Script-based guess. Returns null rather than a wrong answer for ambiguous Latin or Cyrillic text. */
export function detectLangFromText(text: string): { lang: string; strong: boolean } | null {
  const sample = text.slice(0, 20_000)
  const kana = count(sample, KANA)
  const han = count(sample, HAN)
  const hangul = count(sample, HANGUL)
  const latin = count(sample, LATIN)
  const cyrillic = count(sample, CYRILLIC)
  const arabic = count(sample, ARABIC)
  const thai = count(sample, THAI)
  const letters = kana + han + hangul + latin + cyrillic + arabic + thai
  if (letters < 20) return null
  const cjk = kana + han
  // Kana is unique to Japanese; even kanji-heavy news text keeps particles in hiragana.
  if (kana > 0 && cjk / letters >= 0.3 && kana / cjk >= 0.05) return { lang: 'ja', strong: true }
  if (hangul / letters >= 0.3) return { lang: 'ko', strong: true }
  if (han / letters >= 0.3 && kana === 0) return { lang: 'zh', strong: true }
  if (thai / letters >= 0.3) return { lang: 'th', strong: true }
  if (latin / letters >= 0.6) {
    const words = sample.toLowerCase().match(/[a-z']+/g) ?? []
    if (words.length >= 20) {
      const hits = words.filter((w) => EN_STOPWORDS.has(w)).length
      if (hits / words.length >= 0.12) return { lang: 'en', strong: false }
    }
  }
  return null
}

export function resolveLang(declared: string | null, text: string): string | null {
  const guess = detectLangFromText(text)
  if (!declared) return guess?.lang ?? null
  if (guess?.strong) {
    const primary = declared.split('-')[0]
    if (primary !== guess.lang) return guess.lang
  }
  return declared
}
