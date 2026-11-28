import {
  type GoogleFlowError,
  type Locale,
  MESSAGE_ERROR_CODES,
  type MessageErrorCode,
} from '@tiger/shared'
import type { ApiClientError } from '../api'
import type { CaptureOutcome } from '../capture'
import type { GoogleExportError } from '../export'
import type { ShareFailure } from '../stores/share'
import type { ShareThreadFailure } from '../stores/share-thread'
import type { AttachFailure } from '../stores/threads'
import { en } from './en'
import { ja } from './ja'
import type { Dictionary, MessageKey } from './keys'

export { type Dictionary, MESSAGE_KEYS, type MessageKey } from './keys'
export { en, ja }

export const dictionaries: Readonly<Record<Locale, Dictionary>> = { ja, en }

/** Look a key up and fill `{name}` placeholders. Japanese is the fallback locale. */
export function t(locale: Locale, key: MessageKey, vars: Record<string, string> = {}): string {
  const text = (dictionaries[locale] ?? ja)[key]
  return text.replace(/\{(\w+)\}/g, (m, name: string) => vars[name] ?? m)
}

export type Translator = (key: MessageKey, vars?: Record<string, string>) => string
export const translator =
  (locale: Locale): Translator =>
  (key, vars) =>
    t(locale, key, vars)

export function errorKey(error: ApiClientError): MessageKey {
  return `error.${error.code}`
}

export function captureKey(outcome: Extract<CaptureOutcome, { ok: false }>): MessageKey {
  // A blocked page explains which rule matched; other failures explain what went wrong.
  return outcome.error === 'blocked' && outcome.reason
    ? `capture.reason.${outcome.reason}`
    : `capture.error.${outcome.error}`
}

export function shareFailureKey(failure: ShareFailure): MessageKey {
  if (failure.kind === 'no-space') return 'share.noSpace'
  if (failure.kind === 'capture') return captureKey(failure.outcome)
  return errorKey(failure.error)
}

export function shareThreadFailureKey(failure: ShareThreadFailure): MessageKey {
  if (failure.kind === 'not-private') return 'shareThread.notPrivate'
  if (failure.kind === 'nothing-to-share') return 'shareThread.nothingToShare'
  return errorKey(failure.error)
}

export function attachFailureKey(failure: AttachFailure): MessageKey {
  if (failure.kind === 'not-allowed') return 'attach.notAllowed'
  if (failure.kind === 'limit') return 'attach.limit'
  return captureKey(failure.outcome)
}

const MESSAGE_CODES = new Set<string>(MESSAGE_ERROR_CODES)
/** The message for an answer's failure (`Message.errorCode` or `message.failed.code`). */
export function aiFailureKey(code: string | null): MessageKey {
  return MESSAGE_CODES.has(code ?? '') ? `ai.${code as MessageErrorCode}` : 'ai.ai_failed'
}

export function googleExportKey(error: GoogleExportError): MessageKey {
  return `export.google.${error}`
}

export function googleFlowKey(error: GoogleFlowError): MessageKey {
  return `google.flow.${error}`
}
