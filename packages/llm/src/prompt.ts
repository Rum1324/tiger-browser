import type { ChatRequest } from './types'

/**
 * The stable context goes first so every provider sees the long shared prefix before the part that
 * can change between requests (providers cache by exact prefix).
 */
export function composeSystem(req: Pick<ChatRequest, 'system' | 'context'>): string {
  return req.context ? `${req.context}\n\n${req.system}` : req.system
}
