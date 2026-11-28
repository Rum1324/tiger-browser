import { inviteTokenFromAppLink, inviteTokenFromArgv } from './invite'

/** The window an invite link is shown in. EngineWindow fits; tests use a fake. No Electron import. */
export interface InviteTarget {
  /** Bring the window to the front. */
  focus(): void
  /** Run once the window's UI can receive events. */
  whenUiLoaded(fn: () => void): void
  emit(event: 'invite.open', payload: { token: string }): void
}

export interface AppLinkDeps {
  /** The focused window, or null when none is open. */
  focused(): InviteTarget | null
  /** Open a window for a link that arrived while none was open. */
  open(): InviteTarget
}

/**
 * OS-level invite links (`tiger://invite/<token>`): from the launch arguments, from a second
 * launch (Windows, Linux) and from `open-url` (macOS). A link is validated, then handed to the
 * focused window's UI as `invite.open`, which only shows the accept dialog: nothing is joined
 * until the member presses Join there. Links that arrive before the app can open windows wait.
 */
export class AppLinks {
  private ready = false
  private waiting: string | null = null

  constructor(private readonly deps: AppLinkDeps) {}

  /** A URL the OS opened Tiger with. Returns whether it was a valid invite link. */
  openUrl(url: string): boolean {
    const token = inviteTokenFromAppLink(url)
    if (!token) return false
    this.offer(token)
    return true
  }

  /** The arguments of this or a second launch. Returns whether they carried an invite link. */
  openArgv(argv: readonly string[]): boolean {
    const token = inviteTokenFromArgv(argv)
    if (!token) return false
    this.offer(token)
    return true
  }

  /** The app can open windows now; a link that arrived during startup is shown. */
  start(): void {
    this.ready = true
    const token = this.waiting
    this.waiting = null
    if (token) this.offer(token)
  }

  private offer(token: string): void {
    if (!this.ready) {
      // Only the latest link matters: the dialog shows one invite at a time.
      this.waiting = token
      return
    }
    const win = this.deps.focused() ?? this.deps.open()
    win.focus()
    win.whenUiLoaded(() => win.emit('invite.open', { token }))
  }
}
