/**
 * Invite links of the configured server: `<serverUrl>/invite#<token>` (the server issues them from
 * its PUBLIC_URL; see apps/server `createInvite`). The server serves no page there, so the engine
 * never loads one: it hands the token to the UI as `invite.open`, and the member decides.
 * No Electron import: unit-testable.
 */

const TOKEN = /^[A-Za-z0-9_-]{10,}$/

export function inviteTokenFromUrl(url: string, serverUrl: string): string | null {
  let target: URL
  let base: URL
  try {
    target = new URL(url)
    base = new URL(serverUrl)
  } catch {
    return null
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null
  if (target.origin !== base.origin) return null
  const root = base.pathname.replace(/\/+$/, '')
  const path = target.pathname.replace(/\/+$/, '')
  if (path !== `${root}/invite`) return null
  let token = target.hash.slice(1)
  try {
    token = decodeURIComponent(token)
  } catch {
    return null
  }
  return TOKEN.test(token) ? token : null
}
