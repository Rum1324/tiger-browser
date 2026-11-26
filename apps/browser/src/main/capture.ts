import type { Extraction } from '@tiger/extract'
import { finalizePage } from '@tiger/extract/finalize'
import {
  fromGoogleExport,
  type GoogleExportResponse,
  planGoogleExport,
} from '@tiger/extract/google'
import type { PdfResult } from '@tiger/extract/pdf'
import { type CaptureEligibility, type CaptureResult, captureEligibility } from '@tiger/shared'
import { z } from 'zod'

/** What the tab preload sends back for one extraction request. Page-controlled data: validated. */
export const DomReply = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('dom'),
    url: z.string(),
    extraction: z
      .object({
        title: z.string(),
        markdown: z.string(),
        lang: z.string().nullable(),
        byline: z.string().nullable(),
        siteName: z.string().nullable(),
        extractor: z.string(),
        truncated: z.boolean().optional(),
      })
      .nullable(),
  }),
  /** The main frame is Chromium's PDF viewer: the bytes must be read instead of the DOM. */
  z.object({ kind: z.literal('pdf'), url: z.string() }),
  z.object({ kind: z.literal('error'), url: z.string(), message: z.string() }),
])
export type DomReply = z.infer<typeof DomReply>

export interface FetchedResource {
  status: number
  contentType: string | null
  finalUrl: string | null
  body: Uint8Array
}

/** The tab as the main process sees it at the moment of the call (never what the UI claims). */
export interface CaptureTarget {
  /** The committed URL of the tab's main frame. */
  currentUrl(): string
  title(): string
  isPrivate: boolean
}

export interface CaptureDeps {
  userBlockedHosts(): readonly string[]
  now(): Date
  /** Run the isolated-world extractor in the tab. */
  extractDom(): Promise<DomReply>
  /**
   * GET with the tab's own session, cookies included.
   * - `export`: a fresh network read (Google exports must be current); redirects are followed and
   *   the caller checks where they ended.
   * - `displayed-copy`: the bytes the tab already loaded, from the HTTP cache only, never from the
   *   network, and never through a redirect. Rejects when the cache no longer holds them.
   */
  fetchWithTabSession(url: string, mode: 'export' | 'displayed-copy'): Promise<FetchedResource>
  extractPdf(bytes: Uint8Array): Promise<PdfResult>
}

export function eligibilityFor(
  url: string,
  isPrivate: boolean,
  userBlockedHosts: readonly string[],
): CaptureEligibility {
  return captureEligibility(url, { incognito: isPrivate, userBlockedHosts })
}

const blocked = (e: CaptureEligibility): CaptureResult => ({
  ok: false,
  error: 'blocked',
  reason: e.reason,
  detail: e.rule,
})
const failure = (
  error: 'empty' | 'no-text-layer' | 'failed',
  detail: string | null,
): CaptureResult => ({
  ok: false,
  error,
  reason: null,
  detail,
})

const GOOGLE_EXPORT_HOST = 'docs.google.com'

function isGoogleSignIn(url: string): boolean {
  try {
    return new URL(url).hostname === 'accounts.google.com'
  } catch {
    return false
  }
}

/** Why a Google export did not yield the document, in words the UI can show. */
function googleExportFailure(responses: readonly GoogleExportResponse[]): string {
  for (const res of responses) {
    if (res.finalUrl && isGoogleSignIn(res.finalUrl)) return 'google-export: not signed in to this account'
    if (res.status === 401 || res.status === 403)
      return `google-export: HTTP ${res.status} (export or download disabled for this account)`
    if (res.status === 404) return 'google-export: HTTP 404 (not found for this account)'
    if (res.status < 200 || res.status > 299) return `google-export: HTTP ${res.status}`
    if (res.contentType && /text\/html/i.test(res.contentType))
      return 'google-export: Google answered with a web page instead of the export'
  }
  return 'google-export: the export was empty'
}

function isPdfResource(url: string, contentType: string | null): boolean {
  if (contentType && /application\/pdf/i.test(contentType)) return true
  try {
    return /\.pdf$/i.test(new URL(url).pathname)
  } catch {
    return false
  }
}

/**
 * The privacy boundary. Eligibility is decided here, from the tab's committed URL and session, at the
 * moment of the call; a UI request for a blocked page is refused whatever it says. The result is
 * checked again afterwards, so a navigation during extraction cannot smuggle out a blocked page.
 * The only network traffic is the Google export fetch (to docs.google.com). The PDF re-read takes
 * the displayed bytes from the tab session's HTTP cache and never touches the network, so a server
 * cannot hand over a different document (or redirect to another site) on the second request.
 */
export async function captureTab(target: CaptureTarget, deps: CaptureDeps): Promise<CaptureResult> {
  const url = target.currentUrl()
  const eligibility = eligibilityFor(url, target.isPrivate, deps.userBlockedHosts())
  if (!eligibility.allowed) return blocked(eligibility)

  // Re-checked after any await: the tab may have navigated meanwhile.
  const stillAllowed = (): CaptureResult | null => {
    const now = target.currentUrl()
    if (now === url) return null
    const again = eligibilityFor(now, target.isPrivate, deps.userBlockedHosts())
    return again.allowed ? failure('failed', 'navigated during capture') : blocked(again)
  }

  try {
    let extraction: Extraction | null = null

    const plan = planGoogleExport(url)
    if (plan?.requests.every((r) => new URL(r.url).hostname === GOOGLE_EXPORT_HOST)) {
      const responses: GoogleExportResponse[] = []
      for (const req of plan.requests) {
        const res = await deps.fetchWithTabSession(req.url, 'export')
        // A redirect may have taken the export elsewhere: the place it ended must be capturable too.
        // Google's sign-in page is never read (fromGoogleExport rejects it) and is reported as such.
        if (res.finalUrl && res.finalUrl !== req.url && !isGoogleSignIn(res.finalUrl)) {
          const landed = eligibilityFor(res.finalUrl, target.isPrivate, deps.userBlockedHosts())
          if (!landed.allowed) return blocked(landed)
        }
        responses.push({
          status: res.status,
          contentType: res.contentType,
          body: new TextDecoder().decode(res.body),
          finalUrl: res.finalUrl,
        })
      }
      extraction = fromGoogleExport(plan, responses, { title: target.title(), lang: null })
      // The editor is canvas-rendered: its DOM holds menus and toolbars, never the document. A refused
      // export is reported, not replaced by that chrome text.
      if (!extraction) {
        const moved = stillAllowed()
        if (moved) return moved
        return failure('failed', googleExportFailure(responses))
      }
    }

    if (!extraction) {
      const reply = await deps.extractDom()
      const moved = stillAllowed()
      if (moved) return moved
      if (reply.kind === 'error') return failure('failed', reply.message)
      if (reply.kind === 'pdf') {
        const res = await deps.fetchWithTabSession(url, 'displayed-copy')
        // The committed URL is already past any redirect; bytes from anywhere else are not this page.
        if (res.finalUrl && res.finalUrl !== url) {
          const landed = eligibilityFor(res.finalUrl, target.isPrivate, deps.userBlockedHosts())
          if (!landed.allowed) return blocked(landed)
          return failure('failed', 'the PDF re-read was redirected away from the displayed URL')
        }
        if (res.status < 200 || res.status >= 300) return failure('failed', `HTTP ${res.status}`)
        if (!isPdfResource(res.finalUrl ?? url, res.contentType) && res.contentType !== null) {
          return failure('failed', `not a PDF: ${res.contentType}`)
        }
        const pdf = await deps.extractPdf(res.body)
        if (!pdf.extraction) {
          // A scanned PDF has pages but no text; the UI explains that OCR is not supported.
          if (pdf.reason === 'no-text-layer') return failure('no-text-layer', pdf.detail)
          return failure('failed', `${pdf.reason}: ${pdf.detail}`)
        }
        extraction = pdf.extraction
      } else {
        extraction = reply.extraction
      }
    }

    const moved = stillAllowed()
    if (moved) return moved
    if (!extraction?.markdown.trim()) return failure('empty', null)
    const page = finalizePage(extraction, { url, capturedAt: deps.now() })
    return { ok: true, page }
  } catch (err) {
    return failure('failed', err instanceof Error ? err.message : String(err))
  }
}
