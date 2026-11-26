/**
 * Stable machine codes. Clients branch on these, so renaming one is a breaking change.
 */
export type ErrorCode =
  | 'invalid_request'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'space_not_found'
  | 'item_not_found'
  | 'thread_not_found'
  | 'invite_not_found'
  | 'invite_expired'
  | 'invite_revoked'
  | 'invite_used'
  | 'invite_email_mismatch'
  | 'member_not_found'
  | 'last_owner'
  | 'capture_blocked'
  | 'attachments_not_allowed'
  | 'already_shared'
  | 'budget_exceeded'
  | 'model_unavailable'
  | 'ai_unavailable'
  | 'dev_login_disabled'
  | 'google_auth_unavailable'
  | 'google_token_invalid'
  | 'rate_limited'
  | 'payload_too_large'
  | 'contract_violation'
  | 'internal'

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const notFound = (code: ErrorCode, what: string) =>
  new AppError(404, code, `${what} not found`)
export const badRequest = (code: ErrorCode, message: string) => new AppError(400, code, message)
export const forbidden = (message: string) => new AppError(403, 'forbidden', message)
