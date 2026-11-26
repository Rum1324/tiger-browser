import {
  API_ERROR_CODES,
  CAPTURE_BLOCK_REASONS,
  GoogleFlowError,
  MESSAGE_ERROR_CODES,
} from '@tiger/shared'
import { CAPTURE_ERRORS } from '../capture'
import { GOOGLE_EXPORT_ERRORS } from '../export'
import { CONNECTION_STATES } from '../realtime'

/**
 * Every message this layer can report has a key here. The dictionaries are typed against this list,
 * so a new error code without a translation is a compile error (and a test enumerates them too).
 */

export const SHARE_OUTCOMES = ['new', 'version', 'unchanged'] as const
export const STALE_STATUSES = ['fresh', 'stale', 'not-shared'] as const

const prefixed = <P extends string, T extends string>(prefix: P, list: readonly T[]) =>
  list.map((x) => `${prefix}${x}` as `${P}${T}`)

export const MESSAGE_KEYS = [
  ...prefixed('error.', API_ERROR_CODES),
  'error.network',
  'error.aborted',
  ...prefixed('capture.reason.', CAPTURE_BLOCK_REASONS),
  ...prefixed('capture.error.', CAPTURE_ERRORS),
  ...prefixed('connection.', CONNECTION_STATES),
  ...prefixed('share.outcome.', SHARE_OUTCOMES),
  ...prefixed('share.stale.', STALE_STATUSES),
  'share.noSpace',
  ...prefixed('ai.', MESSAGE_ERROR_CODES),
  'attach.notAllowed',
  'attach.limit',
  ...prefixed('export.google.', GOOGLE_EXPORT_ERRORS),
  ...prefixed('google.flow.', GoogleFlowError.options),
  'invite.opened',
  'export.recordFailed',
  'export.sourcesHeading',
  'provider.sendsTo',
  'provider.local',
] as const

export type MessageKey = (typeof MESSAGE_KEYS)[number]
export type Dictionary = Readonly<Record<MessageKey, string>>
