import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { GoogleConnection } from '@tiger/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeGoogle } from '../fake-google'
import { launch, removeDir, type TigerApp, tempDir, waitFor } from './app'

const JA_MARKDOWN = `# 週次まとめ

チームの決定事項を共有します。

| 項目 | 担当 | 期限 |
| --- | --- | --- |
| 見積書の送付 | 佐藤 | 12月1日 |
| 契約書レビュー | 鈴木 | 12月4日 |

> 次回は**木曜日**に確認します。
`

let google: FakeGoogle
let dir: string

beforeAll(async () => {
  google = await new FakeGoogle({ email: 'hanako@example.co.jp' }).start()
  dir = tempDir('google')
})
afterAll(async () => {
  await google?.close()
  removeDir(dir)
})

/** The sealed Google account row in the profile database, read after the app has closed. */
function storedAccount(userDataDir: string): string | null {
  const db = new DatabaseSync(join(userDataDir, 'tiger.db'))
  try {
    const row = db.prepare("SELECT value FROM kv WHERE key = 'google.account'").get() as
      | { value: string }
      | undefined
    return row?.value ?? null
  } finally {
    db.close()
  }
}

async function recordGoogleEvents(t: TigerApp): Promise<() => Promise<GoogleConnection[]>> {
  await t.ui.evaluate(() => {
    const w = window as unknown as { __google: unknown[] }
    w.__google = []
    window.tiger.on('google.changed', (c) => w.__google.push(c))
  })
  return () => t.ui.evaluate(() => (window as unknown as { __google: GoogleConnection[] }).__google)
}

describe('Google account through window.tiger', () => {
  it('signs in, connects, exports a Japanese document with a table, and disconnects', async () => {
    const a = await launch({ userDataDir: dir, env: google.env() })
    try {
      const events = await recordGoogleEvents(a)
      expect(await a.invoke('google.status')).toEqual({
        configured: true,
        connected: false,
        email: null,
      })

      // Sign-in: an ID token for the server, nothing stored.
      const signIn = await a.invoke('auth.googleSignIn')
      expect(signIn?.idToken.split('.')).toHaveLength(3)
      const claims = JSON.parse(
        Buffer.from(signIn?.idToken.split('.')[1] ?? '', 'base64url').toString(),
      )
      expect(claims).toMatchObject({ email: 'hanako@example.co.jp', aud: google.clientId })
      expect(google.liveRefreshTokens).toEqual([])
      expect((await a.invoke('google.status')).connected).toBe(false)

      // Connect: Drive grant, sealed refresh token, broadcast.
      const connected = await a.invoke('google.connect')
      const expected = { configured: true, connected: true, email: 'hanako@example.co.jp' }
      expect(connected).toEqual(expected)
      expect(await a.invoke('google.status')).toEqual(expected)
      expect(await waitFor(async () => (await events()).length === 1 && events())).toEqual([
        expected,
      ])

      // Export.
      const result = await a.invoke('google.exportDoc', {
        title: '週次まとめ 2026-11-26',
        markdown: JA_MARKDOWN,
      })
      expect(google.problems).toEqual([])
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.url).toBe(
        `https://docs.google.com/document/d/${result.docId}/edit?usp=drivesdk`,
      )
      expect(google.uploads).toHaveLength(1)
      expect(google.uploads[0]).toMatchObject({
        name: '週次まとめ 2026-11-26',
        metadataMime: 'application/vnd.google-apps.document',
        mediaType: 'text/markdown',
        content: JA_MARKDOWN,
      })
      // Every code redeemed by the engine passed the PKCE check.
      expect(google.codeExchanges.length).toBe(2)
      expect(google.codeExchanges.every((x) => x.verifierOk)).toBe(true)
    } finally {
      await a.close()
    }

    // The refresh token is on disk only as ciphertext.
    const [refresh] = google.liveRefreshTokens
    const sealed = storedAccount(dir)
    expect(sealed).toBeTruthy()
    expect(sealed).not.toContain(refresh)
    expect(Buffer.from(sealed ?? '', 'base64').toString('latin1')).not.toContain(refresh)

    // Next start: still connected; an expired access token is refreshed; disconnect clears it all.
    const b = await launch({ userDataDir: dir, env: google.env() })
    try {
      const events = await recordGoogleEvents(b)
      expect((await b.invoke('google.status')).connected).toBe(true)
      google.rejectMarkdown = true
      const html = await b.invoke('google.exportDoc', { title: '表', markdown: JA_MARKDOWN })
      google.rejectMarkdown = false
      expect(html.ok).toBe(true)
      expect(google.refreshCount).toBe(1)
      expect(google.uploads[1]?.mediaType).toBe('text/html')
      expect(google.uploads[1]?.content).toContain('<td>見積書の送付</td>')

      const off = await b.invoke('google.disconnect')
      expect(off).toEqual({ configured: true, connected: false, email: null })
      expect(google.revoked).toContain(refresh)
      expect(google.liveRefreshTokens).toEqual([])
      expect(await waitFor(async () => (await events()).length === 1 && events())).toEqual([off])
      expect(await b.invoke('google.exportDoc', { title: 't', markdown: 'm' })).toEqual({
        ok: false,
        error: 'not-connected',
        detail: null,
      })
    } finally {
      await b.close()
    }
    expect(storedAccount(dir)).toBeNull()
  })

  it('reports not-configured for every command without a client id, and calls nobody', async () => {
    const other = tempDir('google-off')
    const before = google.requests.length
    // Endpoints still point at the fake: only the missing client id keeps the engine quiet.
    const { TIGER_GOOGLE_CLIENT_ID: _omit, ...env } = google.env()
    const t = await launch({ userDataDir: other, env })
    try {
      const events = await recordGoogleEvents(t)
      const none = { configured: false, connected: false, email: null }
      expect(await t.invoke('google.status')).toEqual(none)
      expect(await t.invoke('google.connect')).toEqual(none)
      expect(await t.invoke('google.disconnect')).toEqual(none)
      expect(await t.invoke('auth.googleSignIn')).toBeNull()
      expect(await t.invoke('google.exportDoc', { title: 't', markdown: '# m' })).toEqual({
        ok: false,
        error: 'not-configured',
        detail: null,
      })
      expect(await events()).toEqual([])
      expect(google.requests.length).toBe(before)
    } finally {
      await t.close()
      removeDir(other)
    }
  })
})
