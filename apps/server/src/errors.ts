import type { ApiErrorCode } from '@tiger/shared'

/**
 * Stable machine codes, taken from the shared contract so the server and its clients cannot drift.
 * Clients branch on these, so renaming one is a breaking change.
 */
export type ErrorCode = ApiErrorCode

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
