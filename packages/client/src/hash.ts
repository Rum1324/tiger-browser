/**
 * SHA-256 hex of UTF-8 text, the same digest the server stores as `ItemVersionRef.contentHash`.
 * WebCrypto exists in Electron renderers, browsers and Node 22, so no Node API is needed.
 */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('WebCrypto is not available')
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
