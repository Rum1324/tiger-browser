import { randomBytes } from 'node:crypto'
import type { FetchLike } from './config'

export const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document'
const UPLOAD_TIMEOUT_MS = 60_000

export type MediaType = 'text/markdown' | 'text/html'

export interface Multipart {
  contentType: string
  body: string
}

/**
 * Drive's multipart/related upload: a JSON metadata part, then the media part. The boundary is
 * random and checked against the content, so no line of the document can end the part early.
 */
export function multipartBody(
  metadata: Record<string, unknown>,
  media: string,
  mediaType: MediaType,
  boundary = `tiger-${randomBytes(16).toString('hex')}`,
): Multipart {
  if (media.includes(boundary)) return multipartBody(metadata, media, mediaType)
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mediaType}; charset=UTF-8`,
    '',
    media,
    `--${boundary}--`,
    '',
  ].join('\r\n')
  return { contentType: `multipart/related; boundary=${boundary}`, body }
}

export function uploadUrl(endpoint: string): string {
  const url = new URL(endpoint)
  url.searchParams.set('uploadType', 'multipart')
  url.searchParams.set('fields', 'id,webViewLink')
  return url.toString()
}

export type UploadOutcome =
  | { ok: true; id: string; url: string }
  | { ok: false; kind: 'http'; status: number; reasons: string[]; message: string }
  | { ok: false; kind: 'network'; message: string }

/** Google's JSON error envelope: { error: { code, message, errors: [{ reason }] } }. */
function parseGoogleError(json: unknown): { reasons: string[]; message: string } {
  const e = (json as { error?: unknown } | null)?.error
  if (!e || typeof e !== 'object') return { reasons: [], message: '' }
  const { message, errors, status } = e as { message?: unknown; errors?: unknown; status?: unknown }
  const reasons = Array.isArray(errors)
    ? errors
        .map((x) => (x && typeof x === 'object' ? (x as { reason?: unknown }).reason : null))
        .filter((r): r is string => typeof r === 'string')
    : []
  if (typeof status === 'string') reasons.push(status)
  return { reasons, message: typeof message === 'string' ? message.slice(0, 300) : '' }
}

export async function uploadDocument(
  fetchImpl: FetchLike,
  endpoint: string,
  accessToken: string,
  doc: { title: string; content: string; mediaType: MediaType },
): Promise<UploadOutcome> {
  const part = multipartBody(
    { name: doc.title, mimeType: GOOGLE_DOC_MIME },
    doc.content,
    doc.mediaType,
  )
  let res: Response
  try {
    res = await fetchImpl(uploadUrl(endpoint), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': part.contentType,
        Accept: 'application/json',
      },
      body: part.body,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    })
  } catch (err) {
    return { ok: false, kind: 'network', message: (err as Error).message }
  }
  const text = await res.text().catch(() => '')
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (res.ok) {
    const { id, webViewLink } = (json ?? {}) as { id?: unknown; webViewLink?: unknown }
    if (typeof id !== 'string' || !id) {
      return {
        ok: false,
        kind: 'http',
        status: res.status,
        reasons: [],
        message: 'no file id in the response',
      }
    }
    const url =
      typeof webViewLink === 'string' && webViewLink.startsWith('https://')
        ? webViewLink
        : `https://docs.google.com/document/d/${encodeURIComponent(id)}/edit`
    return { ok: true, id, url }
  }
  return { ok: false, kind: 'http', status: res.status, ...parseGoogleError(json) }
}
