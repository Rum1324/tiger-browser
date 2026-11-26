import type { KvStore } from './db'

const KEY = 'auth.token'

/** The OS keychain seam: Electron's async safeStorage in the app, a fake in tests. */
export interface Cipher {
  isAvailable(): Promise<boolean>
  encrypt(plain: string): Promise<Buffer>
  decrypt(sealed: Buffer): Promise<string>
}

/**
 * The product session token. Only ciphertext from the OS keychain is written to disk; when the
 * keychain is unavailable the token is refused rather than stored in the clear.
 */
export class TokenStore {
  constructor(
    private readonly kv: KvStore,
    private readonly cipher: Cipher,
  ) {}

  async get(): Promise<string | null> {
    const sealed = this.kv.get(KEY)
    if (!sealed) return null
    if (!(await this.cipher.isAvailable())) return null
    try {
      return await this.cipher.decrypt(Buffer.from(sealed, 'base64'))
    } catch {
      // A token sealed by another keychain (profile copied between machines) cannot be read; drop it.
      this.kv.delete(KEY)
      return null
    }
  }

  async set(token: string | null): Promise<void> {
    if (token === null) {
      this.kv.delete(KEY)
      return
    }
    if (!(await this.cipher.isAvailable())) {
      throw new Error('secure storage is not available on this system')
    }
    const sealed = await this.cipher.encrypt(token)
    this.kv.set(KEY, sealed.toString('base64'))
  }
}
