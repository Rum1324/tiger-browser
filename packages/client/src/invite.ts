/**
 * Pull the invite token out of whatever the member pasted: the full link the server issues
 * (`<PUBLIC_URL>/invite#<token>`), a link with `?token=`, or the bare token. Returns null when nothing
 * token-shaped is there, so the UI can say so without a request.
 */
export function parseInviteToken(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  let candidate = text
  const hash = text.indexOf('#')
  if (hash >= 0) {
    candidate = text.slice(hash + 1)
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      const url = new URL(text)
      candidate =
        url.searchParams.get('token') ?? url.pathname.split('/').filter(Boolean).at(-1) ?? ''
    } catch {
      return null
    }
  }
  candidate = decodeURIComponentSafe(candidate.trim())
  // Server tokens are base64url; anything else is a paste mistake.
  return /^[A-Za-z0-9_-]{10,}$/.test(candidate) ? candidate : null
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
