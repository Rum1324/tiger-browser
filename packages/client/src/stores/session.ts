import { api, type GoogleFlowError, type Space, type User } from '@tiger/shared'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { type ApiClientError, toClientError } from '../api'
import type { ClientContext } from '../load'

/**
 * `booting`: reading the stored token and checking it. `signedOut`: no session.
 * `signingIn`: a dev or Google sign-in is running. `signedIn`: `user` is set.
 * `offline`: a token exists but the server could not be reached to check it; `boot()` retries.
 */
export type SessionStatus = 'booting' | 'signedOut' | 'signingIn' | 'signedIn' | 'offline'

export interface SessionState {
  status: SessionStatus
  user: User | null
  /** The last failure, cleared by the next attempt. A cancelled Google sign-in is not an error. */
  error: ApiClientError | null
  /**
   * Why the last Google sign-in did not reach the server (`not-configured`, `denied`, `timeout`,
   * `cancelled`, `failed`), or null. Cleared by the next attempt.
   */
  googleError: GoogleFlowError | null
}

export interface SessionEvents {
  signedIn(user: User, spaces: Space[]): void
  signedOut(): void
}

export interface SessionController {
  store: StoreApi<SessionState>
  /** The bearer token, kept out of the observable state so the UI never renders or logs it. */
  token(): string | null
  boot(): Promise<void>
  devLogin(email: string, name: string): Promise<void>
  /**
   * Resolves true when signed in. False when the Google flow did not complete (`googleError` says
   * why) or the server refused the token (`error`).
   */
  signInWithGoogle(): Promise<boolean>
  logout(): Promise<void>
  /** The server said the session is gone (401 on a call or 4401 on the socket). */
  expire(): Promise<void>
  updateMe(patch: { name?: string; locale?: 'ja' | 'en' }): Promise<void>
}

export function createSession(ctx: ClientContext, events: SessionEvents): SessionController {
  const store = createStore<SessionState>()(() => ({
    status: 'booting',
    user: null,
    error: null,
    googleError: null,
  }))
  let token: string | null = null

  async function finish(newToken: string): Promise<void> {
    token = newToken
    const me = await ctx.api.call(api.me, {})
    store.setState({ status: 'signedIn', user: me.user, error: null })
    events.signedIn(me.user, me.spaces)
  }

  async function clearLocal(error: ApiClientError | null = null): Promise<void> {
    const wasSignedIn = store.getState().status === 'signedIn'
    token = null
    await ctx.bridge.invoke('auth.setToken', { token: null })
    store.setState({ status: 'signedOut', user: null, error })
    if (wasSignedIn) events.signedOut()
  }

  return {
    store,
    token: () => token,

    async boot() {
      store.setState({ status: 'booting', error: null })
      const stored = await ctx.bridge.invoke('auth.getToken')
      if (!stored) {
        store.setState({ status: 'signedOut', user: null })
        return
      }
      try {
        await finish(stored)
      } catch (e) {
        const err = toClientError(e)
        if (err.kind === 'network') {
          // Keep the token: the member is offline, not signed out.
          token = stored
          store.setState({ status: 'offline', error: err })
        } else {
          await clearLocal(err.code === 'unauthenticated' ? null : err)
        }
      }
    },

    async devLogin(email, name) {
      store.setState({ status: 'signingIn', error: null })
      try {
        const session = await ctx.api.call(api.authDev, { body: { email, name } })
        await ctx.bridge.invoke('auth.setToken', { token: session.token })
        await finish(session.token)
      } catch (e) {
        token = null
        store.setState({ status: 'signedOut', user: null, error: toClientError(e) })
      }
    },

    async signInWithGoogle() {
      store.setState({ status: 'signingIn', error: null, googleError: null })
      try {
        const google = await ctx.bridge.invoke('auth.googleSignIn')
        if (!google.ok) {
          store.setState({ status: 'signedOut', error: null, googleError: google.error })
          return false
        }
        const session = await ctx.api.call(api.authGoogle, { body: { idToken: google.idToken } })
        await ctx.bridge.invoke('auth.setToken', { token: session.token })
        await finish(session.token)
        return true
      } catch (e) {
        token = null
        store.setState({ status: 'signedOut', user: null, error: toClientError(e) })
        return false
      }
    },

    async logout() {
      if (token) {
        try {
          await ctx.api.call(api.authLogout, {})
        } catch {
          // The local sign-out must happen even when the server is unreachable.
        }
      }
      await clearLocal()
    },

    async expire() {
      if (store.getState().status !== 'signedIn') return
      await clearLocal()
    },

    async updateMe(patch) {
      const user = await ctx.api.call(api.updateMe, { body: patch })
      store.setState({ user })
    },
  }
}
