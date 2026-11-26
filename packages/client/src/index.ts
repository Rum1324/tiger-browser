/**
 * @tiger/client: everything the browser UI needs below the pixels.
 *
 *   const client = createTigerClient({ serverUrl, bridge: window.tiger })
 *   await client.start()                       // boot from the engine's stored token
 *   client.spaces.store.subscribe(render)      // vanilla zustand stores
 *   await client.share.begin(tabId)            // preview; nothing is sent
 *   await client.share.confirm()               // the only call that sends the page
 *
 * No Electron and no React here; `@tiger/client/react` adds a hook for React components.
 */
export {
  type ApiClient,
  ApiClientError,
  type ApiClientOptions,
  type ApiErrorKind,
  type CallOptions,
  type ClientErrorCode,
  createApiClient,
  type FetchLike,
  isApiClientError,
  toClientError,
} from './api'
export {
  CAPTURE_ERRORS,
  type CaptureError,
  type CaptureOutcome,
  extractTab,
} from './capture'
export {
  createTigerClient,
  type TigerClient,
  type TigerClientOptions,
  type UiState,
} from './client'
export { Emitter } from './emitter'
export {
  answerToMarkdown,
  type ExportController,
  GOOGLE_EXPORT_ERRORS,
  type GoogleExportError,
  type GoogleExportResult,
} from './export'
export { sha256Hex } from './hash'
export * from './i18n'
export { parseInviteToken } from './invite'
export type { Load, LoadStatus } from './load'
export {
  CONNECTION_STATES,
  type ConnectionState,
  RealtimeClient,
  type RealtimeEvents,
  type RealtimeOptions,
  type WebSocketCtor,
  type WebSocketLike,
} from './realtime'
export type { ActivityController, ActivityState } from './stores/activity'
export type { GoogleController, GoogleState } from './stores/google'
export {
  type ItemsController,
  type ItemsState,
  indexEntryOf,
  NOT_ELIGIBLE,
  type ShareLocation,
  tabLookupKey,
  type UrlShare,
  type UrlShareController,
  type UrlShareState,
} from './stores/items'
export {
  type ModelsController,
  type ModelsState,
  PROVIDER_COMPANY,
  type SelectedModel,
} from './stores/models'
export type { SessionController, SessionState, SessionStatus } from './stores/session'
export type {
  ShareFailure,
  ShareFlowController,
  ShareFlowState,
  StaleCheck,
} from './stores/share'
export type {
  CreatedInvite,
  SpaceDetail,
  SpacesController,
  SpacesState,
} from './stores/spaces'
export {
  type AttachFailure,
  type AttachFlowState,
  MAX_ATTACHMENTS,
  type MessagePhase,
  type PostOptions,
  type ThreadMessages,
  type ThreadsController,
  type ThreadsState,
  type ViewMessage,
} from './stores/threads'
