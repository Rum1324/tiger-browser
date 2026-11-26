/**
 * One page, one key. The same document reached through different links (a fragment, a tracking
 * parameter, a Google Docs `/edit` suffix) must map to the same shared item, on the client when it
 * asks "is this tab shared?" and on the server when it stores the item.
 */

const TRACKING_PARAM =
  /^(utm_[a-z0-9_]+|gclid|gbraid|wbraid|dclid|fbclid|msclkid|mc_cid|mc_eid|igshid|yclid|_hsenc|_hsmi|ref_src|ref_url)$/i

/** Google editors: the document id is the identity; view mode, tab and user index are not. */
const GOOGLE_EDITOR = /^\/(document|spreadsheets|presentation)\/(?:u\/\d+\/)?d\/([^/]+)/

export function canonicalUrl(rawUrl: string): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return rawUrl.trim()
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return rawUrl.trim()

  const host = url.hostname.toLowerCase().replace(/\.$/, '')

  if (host === 'docs.google.com') {
    const m = GOOGLE_EDITOR.exec(url.pathname)
    if (m) return `https://docs.google.com/${m[1]}/d/${m[2]}`
  }

  const params = [...url.searchParams.entries()].filter(([key]) => !TRACKING_PARAM.test(key))
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const query = new URLSearchParams(params).toString()

  const port = url.port ? `:${url.port}` : ''
  let path = url.pathname
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)

  return `${url.protocol}//${host}${port}${path}${query ? `?${query}` : ''}`
}
