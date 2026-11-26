import {
  API_ERROR_CODES,
  CAPTURE_BLOCK_REASONS,
  GoogleFlowError,
  MESSAGE_ERROR_CODES,
} from '@tiger/shared'
import { describe, expect, it } from 'vitest'
import {
  ApiClientError,
  aiFailureKey,
  CAPTURE_ERRORS,
  CONNECTION_STATES,
  captureKey,
  dictionaries,
  en,
  errorKey,
  GOOGLE_EXPORT_ERRORS,
  ja,
  MESSAGE_KEYS,
  type MessageKey,
  t,
} from '../src'

const JAPANESE = /[぀-ヿ一-鿿]/

describe('message dictionaries', () => {
  const required: MessageKey[] = [
    ...API_ERROR_CODES.map((c) => `error.${c}` as const),
    'error.network',
    'error.aborted',
    ...CAPTURE_BLOCK_REASONS.map((r) => `capture.reason.${r}` as const),
    ...CAPTURE_ERRORS.map((e) => `capture.error.${e}` as const),
    ...CONNECTION_STATES.map((s) => `connection.${s}` as const),
    'share.outcome.new',
    'share.outcome.version',
    'share.outcome.unchanged',
    ...MESSAGE_ERROR_CODES.map((c) => `ai.${c}` as const),
    ...GOOGLE_EXPORT_ERRORS.map((e) => `export.google.${e}` as const),
    ...GoogleFlowError.options.map((e) => `google.flow.${e}` as const),
  ]

  it('every ApiErrorCode, capture reason, capture error, connection state and share outcome has a message in both languages', () => {
    expect(API_ERROR_CODES.length).toBeGreaterThan(20)
    for (const key of required) {
      for (const [locale, dict] of Object.entries(dictionaries)) {
        expect(dict[key], `${locale} ${key}`).toBeTypeOf('string')
        expect(dict[key].trim().length, `${locale} ${key}`).toBeGreaterThan(0)
      }
      expect(ja[key], key).toMatch(JAPANESE)
      expect(en[key], key).not.toMatch(JAPANESE)
    }
  })

  it('every ApiErrorCode and message error code says what went wrong and what the member can do next', () => {
    expect(API_ERROR_CODES).toContain('thread_has_private_attachments')
    expect(MESSAGE_ERROR_CODES).toEqual(
      expect.arrayContaining([
        'ai_aborted',
        'ai_failed',
        'ai_interrupted',
        'ai_refused',
        'ai_unavailable',
      ]),
    )
    const keys: MessageKey[] = [
      ...API_ERROR_CODES.map((c) => `error.${c}` as const),
      ...MESSAGE_ERROR_CODES.map((c) => `ai.${c}` as const),
    ]
    for (const key of keys) {
      // Two sentences: the problem, then the next step.
      expect(ja[key].split('。').filter(Boolean).length, `ja ${key}`).toBeGreaterThanOrEqual(2)
      expect(
        en[key].split(/[.!?](?:\s|$)/).filter(Boolean).length,
        `en ${key}`,
      ).toBeGreaterThanOrEqual(2)
    }
  })

  it('both dictionaries have exactly the declared keys', () => {
    expect(Object.keys(ja).sort()).toEqual([...MESSAGE_KEYS].sort())
    expect(Object.keys(en).sort()).toEqual([...MESSAGE_KEYS].sort())
  })

  it('Japanese sentences are plain です/ます and end with a full stop', () => {
    const sentences = MESSAGE_KEYS.filter((k) => k !== 'export.sourcesHeading')
    for (const key of sentences) {
      const text = ja[key]
      expect(text, key).toMatch(/[。…]$/)
      expect(text, key).toMatch(/(です|ます|ません|ました|でした|ください|しています)[。…]$/)
    }
  })

  it('helpers map errors and outcomes to keys, and interpolate', () => {
    expect(errorKey(new ApiClientError('network', 'network', 'x'))).toBe('error.network')
    expect(errorKey(new ApiClientError('server', 'invite_expired', 'x', 410))).toBe(
      'error.invite_expired',
    )
    expect(captureKey({ ok: false, error: 'blocked', reason: 'banking', detail: null })).toBe(
      'capture.reason.banking',
    )
    expect(captureKey({ ok: false, error: 'no-text-layer', reason: null, detail: null })).toBe(
      'capture.error.no-text-layer',
    )
    expect(aiFailureKey('ai_busy')).toBe('ai.ai_busy')
    expect(aiFailureKey('ai_interrupted')).toBe('ai.ai_interrupted')
    expect(aiFailureKey(null)).toBe('ai.ai_failed')
    expect(aiFailureKey('something_new')).toBe('ai.ai_failed')
    expect(t('ja', 'provider.sendsTo', { company: 'Anthropic' })).toBe(
      '内容は Anthropic に送られます。',
    )
    expect(t('en', 'provider.sendsTo', { company: 'OpenAI' })).toBe('Content is sent to OpenAI.')
  })
})
