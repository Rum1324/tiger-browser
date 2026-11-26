import {
  type EngineCommandName,
  type EngineEventName,
  engineCommands,
  engineEvents,
} from '@tiger/shared'

export type ParsedInvoke =
  | { ok: true; name: EngineCommandName; request: unknown }
  | { ok: false; error: string }

function isCommandName(name: unknown): name is EngineCommandName {
  return typeof name === 'string' && Object.hasOwn(engineCommands, name)
}

/**
 * Validate one `tiger:invoke` message against the contract. Unknown names and malformed requests are
 * rejected before any handler runs; the parsed value (with unknown keys stripped) is what handlers see.
 */
export function parseInvoke(name: unknown, payload: unknown): ParsedInvoke {
  if (!isCommandName(name)) return { ok: false, error: `unknown command: ${String(name)}` }
  const parsed = engineCommands[name].req.safeParse(payload)
  if (!parsed.success) {
    return { ok: false, error: `invalid request for ${name}: ${parsed.error.message}` }
  }
  return { ok: true, name, request: parsed.data }
}

/** Responses are checked too, so an engine bug surfaces as an error instead of a contract breach. */
export function checkResponse(name: EngineCommandName, value: unknown): unknown {
  return engineCommands[name].res.parse(value)
}

export function checkEvent(name: EngineEventName, payload: unknown): unknown {
  return engineEvents[name].parse(payload)
}

/**
 * Whether a frame URL belongs to this app's own UI: the tiger://ui host in production, or the Vite
 * dev server origin when one is configured (development only). Compared on protocol and host
 * because `new URL('tiger://ui/').origin` is the string 'null'.
 */
export function isTrustedUiUrl(frameUrl: string, devServerUrl: string | null): boolean {
  let url: URL
  try {
    url = new URL(frameUrl)
  } catch {
    return false
  }
  if (url.protocol === 'tiger:' && url.host === 'ui') return true
  if (!devServerUrl) return false
  try {
    const dev = new URL(devServerUrl)
    return url.protocol === dev.protocol && url.host === dev.host
  } catch {
    return false
  }
}

export interface SenderInfo {
  /** webContents id of the sender. */
  webContentsId: number
  /** URL of the sending frame, or null when the frame is gone. */
  frameUrl: string | null
  /** True when the sending frame is the top-level frame of its webContents. */
  isMainFrame: boolean
}

/**
 * The full sender rule: the message must come from the main frame of one of our UI views (never a
 * tab, never a subframe) and that frame must still be showing our UI.
 */
export function isTrustedSender(
  sender: SenderInfo,
  uiWebContentsIds: ReadonlySet<number>,
  devServerUrl: string | null,
): boolean {
  if (!uiWebContentsIds.has(sender.webContentsId)) return false
  if (!sender.isMainFrame || sender.frameUrl === null) return false
  return isTrustedUiUrl(sender.frameUrl, devServerUrl)
}
