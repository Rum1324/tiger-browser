import type { KvStore } from './db'

/** The product session token's key; other secrets (the Google account) use their own key. */
export const AUTH_TOKEN_KEY = 'auth.token'

/** The OS keychain seam: Electron's async safeStorage in the app, a fake in tests. */
export interface Cipher {
  isAvailable(): Promise<boolean>
  encrypt(plain: string): Promise<Buffer>
  decrypt(sealed: Buffer): Promise<string>
}

/**
 * One secret sealed by the OS keychain, by default the product session token. Only ciphertext from the OS keychain is written to disk; when the
 * keychain is unavailable the token is refused rather than stored in the clear.
 */
export class TokenStore {
  constructor(
    private readonly kv: KvStore,
    private readonly cipher: Cipher,
    private readonly key: string = AUTH_TOKEN_KEY,
  ) {}

  async get(): Promise<string | null> {
    const sealed = this.kv.get(this.key)
    if (!sealed) return null
    if (!(await this.cipher.isAvailable())) return null
    try {
      return await this.cipher.decrypt(Buffer.from(sealed, 'base64'))
    } catch {
      // A token sealed by another keychain (profile copied between machines) cannot be read; drop it.
      this.kv.delete(this.key)
      return null
    }
  }

  async set(token: string | null): Promise<void> {
    if (token === null) {
      this.kv.delete(this.key)
      return
    }
    if (!(await this.cipher.isAvailable())) {
      throw new Error('secure storage is not available on this system')
    }
    const sealed = await this.cipher.encrypt(token)
    this.kv.set(this.key, sealed.toString('base64'))
  }
}
