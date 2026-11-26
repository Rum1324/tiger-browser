import type { EngineBridge } from '@tiger/shared'
import type { ApiClient, ApiClientError } from './api'

/** Every remote resource in a store carries one of these, so the UI never guesses. */
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface Load {
  status: LoadStatus
  error: ApiClientError | null
}

export const IDLE: Load = Object.freeze({ status: 'idle', error: null }) as Load
export const LOADING: Load = Object.freeze({ status: 'loading', error: null }) as Load
export const READY: Load = Object.freeze({ status: 'ready', error: null }) as Load
export const failed = (error: ApiClientError): Load => ({ status: 'error', error })

/** What every store controller receives from createTigerClient. */
export interface ClientContext {
  api: ApiClient
  bridge: EngineBridge
  /** The signed-in user's id, or null. */
  userId(): string | null
}
