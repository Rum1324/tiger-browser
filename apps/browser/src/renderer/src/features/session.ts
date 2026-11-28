import {
  type ConnectionState,
  errorKey,
  googleFlowKey,
  type SessionStatus,
} from '@tiger/client'
import type { User } from '@tiger/shared'
import { useMemo } from 'react'
import { useServices } from '../app/context'
import type { Notice } from '../i18n'
import { shallow, useStore } from '../lib/store'

export interface SignInView {
  status: SessionStatus
  user: User | null
  /** Why the last attempt failed (server error or Google flow), as a message to show. */
  error: Notice | null
  working: boolean
  signInWithGoogle(): Promise<boolean>
  /** Development servers only (AUTH_DEV_LOGIN=1). */
  devLogin(email: string, name: string): Promise<boolean>
  signOut(): Promise<void>
}

export function useSignIn(): SignInView {
  const { client } = useServices()
  const s = useStore(
    client.session.store,
    (x) => ({ status: x.status, user: x.user, error: x.error, googleError: x.googleError }),
    shallow,
  )
  return useMemo(() => {
    const error: Notice | null = s.googleError
      ? { key: googleFlowKey(s.googleError) }
      : s.error
        ? { key: errorKey(s.error) }
        : null
    return {
      status: s.status,
      user: s.user,
      error,
      working: s.status === 'signingIn' || s.status === 'booting',
      signInWithGoogle: () => client.session.signInWithGoogle(),
      async devLogin(email, name) {
        await client.session.devLogin(email, name)
        return client.session.store.getState().status === 'signedIn'
      },
      signOut: () => client.session.logout(),
    }
  }, [s, client])
}

/** The realtime connection, for the chrome's quiet status line. */
export function useConnection(): { state: ConnectionState; notice: Notice } {
  const { client } = useServices()
  const state = useStore(client.ui, (u) => u.connection)
  return useMemo(() => ({ state, notice: { key: `connection.${state}` } }), [state])
}
