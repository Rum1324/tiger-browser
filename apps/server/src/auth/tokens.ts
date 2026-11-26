import { createHash, randomBytes } from 'node:crypto'

/** 32 random bytes, base64url: an opaque bearer secret (sessions, invites). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Only this digest is stored, so a database leak does not hand out working tokens. */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
