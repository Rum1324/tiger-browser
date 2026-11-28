import { dictionaries as clientDictionaries, type MessageKey } from '@tiger/client'
import type { Locale } from '@tiger/shared'
import { en } from './en'
import { ja, type UiKey } from './ja'

export { en, ja, type UiKey }

/** Every text the UI can show: its own keys plus @tiger/client's messages (errors, refusals…). */
export type TextKey = UiKey | MessageKey
export type Vars = Record<string, string | number>

/** A message to show later, as data (it crosses to the overlay view, so it carries no text). */
export interface Notice {
  key: TextKey
  vars?: Vars
}

export type Translate = (key: TextKey, vars?: Vars) => string

const ui: Readonly<Record<Locale, Readonly<Record<UiKey, string>>>> = { ja, en }

/**
 * Look a key up in the UI dictionary, then in the client's, and fill `{name}` placeholders.
 * Japanese is the fallback locale. A missing placeholder stays visible as `{name}`.
 */
export function translate(locale: Locale, key: TextKey, vars: Vars = {}): string {
  const own = (ui[locale] ?? ja) as Readonly<Record<string, string>>
  const client = (clientDictionaries[locale] ?? clientDictionaries.ja) as Readonly<
    Record<string, string>
  >
  const text = own[key] ?? client[key] ?? key
  return text.replace(/\{(\w+)\}/g, (m, name: string) =>
    vars[name] === undefined ? m : String(vars[name]),
  )
}

export function translator(locale: Locale): Translate {
  return (key, vars) => translate(locale, key, vars)
}

export const UI_KEYS = Object.keys(ja) as UiKey[]
