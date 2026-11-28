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

/** The scheme the operating system hands to Tiger: `tiger://invite/<token>`. */
export const APP_LINK_SCHEME = 'tiger'
const APP_LINK_HOST = 'invite'

/**
 * The token of an OS-level invite link, `tiger://invite/<token>` (a trailing slash is allowed).
 * Anything else under the scheme, including the UI's own `tiger://ui/...`, is not an invite.
 */
export function inviteTokenFromAppLink(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== `${APP_LINK_SCHEME}:` || url.hostname !== APP_LINK_HOST) return null
  if (url.username || url.password || url.port || url.search || url.hash) return null
  const match = /^\/([^/]+)\/?$/.exec(url.pathname)
  if (!match) return null
  let token: string
  try {
    token = decodeURIComponent(match[1] as string)
  } catch {
    return null
  }
  return TOKEN.test(token) ? token : null
}

/**
 * The invite token among a process's arguments (Windows and Linux pass the opened link as one):
 * the first argument that is a valid invite link. Switches and paths never match.
 */
export function inviteTokenFromArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (!arg.toLowerCase().startsWith(`${APP_LINK_SCHEME}:`)) continue
    const token = inviteTokenFromAppLink(arg)
    if (token) return token
  }
  return null
}
