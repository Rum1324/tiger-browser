import type { ClientEvent, ServerEvent } from '@tiger/shared'
import type { WebSocketCtor, WebSocketLike } from '../../src'

/** A scripted WebSocket: the test decides what the "server" answers to each client frame. */
export class FakeSocket implements WebSocketLike {
  readyState = 0
  sent: ClientEvent[] = []
  closedWith: number | null = null
  private listeners = new Map<string, Set<(e: unknown) => void>>()
  constructor(
    readonly url: string,
    private readonly onFrame: (ws: FakeSocket, frame: ClientEvent) => void,
  ) {}
  addEventListener(type: string, listener: (e: unknown) => void): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener)
  }
  fire(type: string, event: unknown): void {
    for (const l of this.listeners.get(type) ?? []) l(event)
  }
  open(): void {
    this.readyState = 1
    this.fire('open', {})
  }
  reply(event: ServerEvent): void {
    this.fire('message', { data: JSON.stringify(event) })
  }
  /** The server closes the connection. */
  drop(code = 1006): void {
    this.readyState = 3
    this.fire('close', { code })
  }
  send(data: string): void {
    const frame = JSON.parse(data) as ClientEvent
    this.sent.push(frame)
    this.onFrame(this, frame)
  }
  close(code = 1000): void {
    this.closedWith = code
    this.readyState = 3
  }
}

export interface FakeServer {
  Ctor: WebSocketCtor
  sockets: FakeSocket[]
}

export const USER_ID = '0197a000-0000-7000-8000-000000000001'

/**
 * Fake endpoint. `behaviour` picks what each new socket does: `normal` answers like the server,
 * `silent` opens and never answers, `no-pong` completes the handshake but ignores pings.
 */
export function fakeServer(
  behaviour: (index: number) => 'normal' | 'silent' | 'no-pong' | 'refuse' = () => 'normal',
): FakeServer {
  const sockets: FakeSocket[] = []
  class Ctor extends FakeSocket {
    constructor(url: string) {
      const index = sockets.length
      const mode = behaviour(index)
      super(url, (ws, frame) => {
        if (mode === 'silent') return
        if (frame.type === 'auth') ws.reply({ type: 'ready', userId: USER_ID })
        if (frame.type === 'subscribe') ws.reply({ type: 'subscribed', spaceIds: frame.spaceIds })
        if (frame.type === 'ping' && mode !== 'no-pong') ws.reply({ type: 'pong' })
      })
      sockets.push(this)
      queueMicrotask(() => (mode === 'refuse' ? this.fire('error', {}) : this.open()))
    }
  }
  return { Ctor: Ctor as unknown as WebSocketCtor, sockets }
}
