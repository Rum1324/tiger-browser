import type { ChatEvent, ChatRequest } from '../src/types'

export async function collect(it: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

export const text = (events: ChatEvent[]): string =>
  events.map((e) => (e.type === 'text' ? e.delta : '')).join('')

export const last = (events: ChatEvent[]): ChatEvent | undefined => events[events.length - 1]

/** An async iterable that yields the items, then optionally throws. */
export async function* iter<T>(items: T[], thenThrow?: unknown): AsyncGenerator<T> {
  for (const i of items) yield i
  if (thenThrow !== undefined) throw thenThrow
}

export function request(over: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: { provider: 'mock', id: 'mock-chat' },
    system: 'You answer from the sources.',
    messages: [{ role: 'user', content: 'What is the plan?' }],
    ...over,
  }
}

/** Shaped like the SDK errors the providers read (status, headers, type, code). */
export function httpError(
  status: number,
  extra: Record<string, unknown> = {},
  message = `HTTP ${status}`,
): Error {
  return Object.assign(new Error(message), { status, ...extra })
}
