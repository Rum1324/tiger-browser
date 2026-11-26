import { createHash, randomBytes } from 'node:crypto'

export interface Pkce {
  verifier: string
  challenge: string
  method: 'S256'
}

const base64url = (b: Buffer) => b.toString('base64url')

/** RFC 7636 S256 challenge of a verifier. */
export function s256(verifier: string): string {
  return base64url(createHash('sha256').update(verifier, 'ascii').digest())
}

/** 32 random bytes give a 43-character verifier, the minimum length RFC 7636 allows. */
export function createPkce(): Pkce {
  const verifier = base64url(randomBytes(32))
  return { verifier, challenge: s256(verifier), method: 'S256' }
}

/** An unguessable value tying the redirect to the request this process started. */
export function randomState(): string {
  return base64url(randomBytes(24))
}
