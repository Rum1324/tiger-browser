import type { CatalogModel } from '../catalog'
import type { ChatEvent, ChatRequest } from '../types'

/** A provider streams one attempt. It never throws: failures become a terminal error event. */
export interface ChatProvider {
  stream(model: CatalogModel, request: ChatRequest): AsyncIterable<ChatEvent>
}
