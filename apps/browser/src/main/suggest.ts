import type { Bookmark, HistoryEntry, Suggestion } from '@tiger/shared'
import { resolveInput, type SearchEngine, searchUrl } from './resolve-input'

export interface SuggestSources {
  tabs: readonly { id: string; url: string; title: string }[]
  bookmarks: readonly Bookmark[]
  history: readonly HistoryEntry[]
  engine: SearchEngine
}

const MAX_TABS = 3
const MAX_BOOKMARKS = 4
const MAX_HISTORY = 6

function matches(text: string, q: string): boolean {
  return text.toLowerCase().includes(q)
}

/**
 * Merge every local source into one list for the address field: what the input resolves to first,
 * then open tabs, bookmarks and history, then a search for the literal text. A URL appears once,
 * at its first (highest) position. Nothing here touches the network.
 */
export function mergeSuggestions(input: string, src: SuggestSources): Suggestion[] {
  const text = input.trim()
  if (!text) return []
  const q = text.toLowerCase()
  const out: Suggestion[] = []
  const seen = new Set<string>()
  const push = (s: Suggestion) => {
    const key = s.kind === 'tab' ? `tab:${s.tabId}` : s.url
    if (seen.has(key)) return
    seen.add(key)
    out.push(s)
  }

  const resolved = resolveInput(text, src.engine)
  const search = searchUrl(text, src.engine)
  if (resolved && resolved !== search) push({ kind: 'url', title: resolved, url: resolved, tabId: null })

  for (const t of src.tabs.filter((t) => matches(t.url, q) || matches(t.title, q)).slice(0, MAX_TABS)) {
    push({ kind: 'tab', title: t.title || t.url, url: t.url, tabId: t.id })
  }
  for (const b of src.bookmarks.slice(0, MAX_BOOKMARKS)) {
    push({ kind: 'bookmark', title: b.title || b.url, url: b.url, tabId: null })
  }
  for (const h of src.history.slice(0, MAX_HISTORY)) {
    push({ kind: 'history', title: h.title || h.url, url: h.url, tabId: null })
  }
  push({ kind: 'search', title: text, url: search, tabId: null })
  return out
}
