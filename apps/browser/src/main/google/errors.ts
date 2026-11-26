/**
 * Why an OAuth step failed. Messages never contain codes, tokens or verifiers.
 * - denied: the member refused consent, or did not grant a required scope.
 * - state-mismatch: the redirect did not carry the state this flow sent.
 * - timeout: nobody came back to the loopback listener in time.
 * - cancelled: a newer flow replaced this one.
 * - invalid-grant: Google no longer accepts the refresh token (revoked or expired).
 * - failed: anything else (network, malformed response, browser could not be opened).
 */
export type GoogleAuthErrorCode =
  | 'denied'
  | 'state-mismatch'
  | 'timeout'
  | 'cancelled'
  | 'invalid-grant'
  | 'failed'

export class GoogleAuthError extends Error {
  constructor(
    readonly code: GoogleAuthErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'GoogleAuthError'
  }
}
