import {
  type CaptureBlockReason,
  type CaptureResult,
  captureEligibility,
  type EngineBridge,
  ExtractedPage,
} from '@tiger/shared'

/** Why a capture produced nothing that may be sent. Mirrors the engine's CaptureResult errors. */
export type CaptureError = Extract<CaptureResult, { ok: false }>['error']
export const CAPTURE_ERRORS = [
  'blocked',
  'empty',
  'no-text-layer',
  'failed',
  'no-tab',
] as const satisfies readonly CaptureError[]

export type CaptureOutcome =
  | { ok: true; page: ExtractedPage }
  | {
      ok: false
      error: CaptureError
      reason: CaptureBlockReason | null
      detail: string | null
    }

/**
 * Extract a tab locally through the engine. Nothing leaves the machine here: the result goes to a
 * preview. The engine already refuses blocked pages; this re-checks the returned page's URL with the
 * same shared rule (defence in depth) and validates the page shape, so a malformed or blocked page
 * can never reach a confirm step.
 */
export async function extractTab(
  bridge: EngineBridge,
  tabId: string,
  userBlockedHosts: readonly string[] = [],
): Promise<CaptureOutcome> {
  let result: CaptureResult
  try {
    result = await bridge.invoke('capture.extract', { tabId })
  } catch (e) {
    return {
      ok: false,
      error: 'failed',
      reason: null,
      detail: e instanceof Error ? e.message : null,
    }
  }
  if (!result.ok) {
    return { ok: false, error: result.error, reason: result.reason, detail: result.detail }
  }
  const parsed = ExtractedPage.safeParse(result.page)
  if (!parsed.success) {
    return { ok: false, error: 'failed', reason: null, detail: 'invalid page from the engine' }
  }
  const eligibility = captureEligibility(parsed.data.url, {
    incognito: false,
    userBlockedHosts,
  })
  if (!eligibility.allowed) {
    return { ok: false, error: 'blocked', reason: eligibility.reason, detail: eligibility.rule }
  }
  if (parsed.data.markdown.trim() === '') {
    return { ok: false, error: 'empty', reason: null, detail: null }
  }
  return { ok: true, page: parsed.data }
}

/** The member's own blocked hosts, read from engine settings at capture time. */
export async function userBlockedHosts(bridge: EngineBridge): Promise<string[]> {
  try {
    return (await bridge.invoke('settings.get')).userBlockedHosts
  } catch {
    return []
  }
}
