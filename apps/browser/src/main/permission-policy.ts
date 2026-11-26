import type { SitePermission } from '@tiger/shared'
import type { PermissionDecisions } from './store/permissions'

/**
 * How an Electron permission request is handled:
 * - `ask`: one of the contract's SitePermission values; the member decides through the UI.
 * - `grant`: granted without asking, as Chrome does, because pages break without it and it exposes
 *   nothing (writing to the clipboard from a click handler, element fullscreen).
 * - `deny`: everything else, including any permission a future Electron adds.
 */
export type PermissionPolicy =
  | { action: 'ask'; permission: SitePermission }
  | { action: 'grant' }
  | { action: 'deny' }

const SILENT_GRANTS = new Set(['clipboard-sanitized-write', 'fullscreen'])

export function policyForRequest(
  permission: string,
  mediaTypes: readonly string[] = [],
): PermissionPolicy {
  if (SILENT_GRANTS.has(permission)) return { action: 'grant' }
  switch (permission) {
    case 'notifications':
      return { action: 'ask', permission: 'notifications' }
    case 'geolocation':
      return { action: 'ask', permission: 'geolocation' }
    case 'clipboard-read':
      return { action: 'ask', permission: 'clipboard-read' }
    case 'display-capture':
      return { action: 'ask', permission: 'screen-capture' }
    case 'media': {
      const video = mediaTypes.includes('video')
      const audio = mediaTypes.includes('audio')
      if (video && audio) return { action: 'ask', permission: 'camera-and-microphone' }
      if (video) return { action: 'ask', permission: 'camera' }
      if (audio) return { action: 'ask', permission: 'microphone' }
      return { action: 'deny' }
    }
    default:
      return { action: 'deny' }
  }
}

/**
 * A grant that is never stored or reused: each screen capture is asked for on its own, as in Chrome.
 * A remembered "block" is still honoured.
 */
export function isOneShotGrant(permission: SitePermission): boolean {
  return permission === 'screen-capture'
}

/** A remembered decision for this request, if any. Camera plus microphone is covered by either form. */
export function rememberedDecision(
  decisions: PermissionDecisions,
  origin: string,
  permission: SitePermission,
): boolean | undefined {
  const direct = decisions.get(origin, permission)
  if (isOneShotGrant(permission)) return direct === false ? false : undefined
  if (direct !== undefined) return direct
  if (permission === 'camera-and-microphone') {
    const cam = decisions.get(origin, 'camera')
    const mic = decisions.get(origin, 'microphone')
    if (cam === false || mic === false) return false
    if (cam === true && mic === true) return true
    return undefined
  }
  if (permission === 'camera' || permission === 'microphone') {
    const both = decisions.get(origin, 'camera-and-microphone')
    if (both !== undefined) return both
  }
  return undefined
}

/**
 * The synchronous permission check (navigator.permissions.query, Notification.permission and the
 * like). Only a remembered "allow" reports granted; the silent grants always do.
 */
export function checkPermission(
  decisions: PermissionDecisions,
  permission: string,
  origin: string,
  mediaType?: string,
): boolean {
  if (SILENT_GRANTS.has(permission)) return true
  let site: SitePermission | null = null
  if (permission === 'media') {
    site = mediaType === 'video' ? 'camera' : mediaType === 'audio' ? 'microphone' : null
  } else {
    const policy = policyForRequest(permission)
    site = policy.action === 'ask' ? policy.permission : null
  }
  if (!site) return false
  return rememberedDecision(decisions, origin, site) === true
}

/** Only http(s) origins can hold a permission; anything else is denied outright. */
export function webOrigin(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}
