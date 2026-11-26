import type { GoogleConnection } from '@tiger/shared'
import { useEffect, useState } from 'react'
import type { Strings } from './i18n'

const tiger = window.tiger

const SAMPLE = `# Tiger export\n\n| 項目 | 状態 |\n| --- | --- |\n| 書き出し | 確認中 |\n`

/** Developer controls for the Google commands; the last capture is exported when there is one. */
export function GooglePanel({ t, markdown }: { t: Strings; markdown: string | null }) {
  const [conn, setConn] = useState<GoogleConnection | null>(null)
  const [result, setResult] = useState('')

  useEffect(() => {
    tiger.invoke('google.status').then(setConn)
    return tiger.on('google.changed', setConn)
  }, [])

  if (!conn) return null
  if (!conn.configured) return <div data-testid="google-status">{t.googleNotConfigured}</div>

  const signIn = async () => {
    const r = await tiger.invoke('auth.googleSignIn')
    // Show only the shape: the ID token is a credential for the server.
    setResult(
      r.ok ? `ID token (${r.idToken.length} chars)` : `sign-in did not complete: ${r.error}`,
    )
  }
  const connect = async () => {
    const r = await tiger.invoke('google.connect')
    setConn(r.connection)
    setResult(r.error ? `connect did not complete: ${r.error}` : '')
  }
  const exportDoc = async () => {
    const r = await tiger.invoke('google.exportDoc', {
      title: `Tiger ${new Date().toISOString().slice(0, 10)}`,
      markdown: markdown ?? SAMPLE,
    })
    setResult(r.ok ? r.url : `${r.error}: ${r.detail ?? ''}`)
  }

  return (
    <div data-testid="google-status">
      <div>{conn.connected ? conn.email : t.googleNotConnected}</div>
      <button type="button" onClick={signIn}>
        {t.googleSignIn}
      </button>
      {conn.connected ? (
        <>
          <button type="button" onClick={exportDoc}>
            {t.googleExport}
          </button>
          <button
            type="button"
            onClick={async () => setConn(await tiger.invoke('google.disconnect'))}
          >
            {t.googleDisconnect}
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={connect}>
            {t.googleConnect}
          </button>
          <button type="button" onClick={() => tiger.invoke('google.cancel')}>
            {t.googleCancel}
          </button>
        </>
      )}
      {result ? <pre>{result}</pre> : null}
    </div>
  )
}
