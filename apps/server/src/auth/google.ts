import { OAuth2Client } from 'google-auth-library'
import type { VerifyGoogleIdToken } from '../seams'

/** Verifies signature, expiry, issuer and audience against Google's published keys. */
export function googleIdTokenVerifier(clientId: string): VerifyGoogleIdToken {
  const client = new OAuth2Client({ clientId })
  return async (idToken) => {
    const ticket = await client.verifyIdToken({ idToken, audience: clientId })
    const p = ticket.getPayload()
    if (!p?.sub || !p.email) throw new Error('ID token has no subject or email')
    return {
      sub: p.sub,
      email: p.email,
      emailVerified: p.email_verified === true,
      name: p.name ?? null,
      picture: p.picture ?? null,
    }
  }
}
