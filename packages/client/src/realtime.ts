import { type ClientEvent, ServerEvent, type ServerEventOf } from '@tiger/shared'
import { Emitter } from './emitter'

/**
 * Realtime client for `/v1/ws` (packages/shared/src/ws.ts): auth frame first, then `subscribe`,
 * heartbeats, reconnect with capped exponential backoff and jitter, and resubscribe. After every
 * reconnect it emits `resync` so stores can refetch what they may have missed while offline.
 */

/**
 * `offline`: not started (signed out). `connecting`: first connection of this session.
 * `online`: authenticated and subscribed. `reconnecting`: the connection was lost and is being
 * retried. `unauthorized`: the server rejected the session (close code 4401); no retry.
 */
export type ConnectionState = 'offline' | 'connecting' | 'online' | 'reconnecting' | 'unauthorized'
export const CONNECTION_STATES = [
  'offline',
  'connecting',
  'online',
  'reconnecting',
  'unauthorized',
] as const satisfies readonly ConnectionState[]

/** The subset of the WHATWG WebSocket the client needs; Node 22's global and browsers both fit. */
export interface WebSocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    // biome-ignore lint/suspicious/noExplicitAny: event objects differ between runtimes
    listener: (event: any) => void,
  ): void
}
export type WebSocketCtor = new (url: string) => WebSocketLike

export type RealtimeEvents = {
  [K in ServerEvent['type']]: ServerEventOf<K>
} & {
  /** Every valid server event, after the typed one. */
  event: ServerEvent
  state: ConnectionState
  /** Fired once per successful reconnect (not on the first connect). */
  resync: undefined
  /** The server closed the socket with 4401: the session is no longer valid. */
  unauthorized: undefined
}

export interface RealtimeOptions {
  serverUrl: string
  getToken: () => string | null
  WebSocket?: WebSocketCtor
  /** First retry delay; doubles per attempt up to `maxBackoffMs`. */
  baseBackoffMs?: number
  maxBackoffMs?: number
  /** How often the client pings. */
  heartbeatMs?: number
  /** A ping with no frame back within this time counts as a dead connection. */
  heartbeatTimeoutMs?: number
  /** Time allowed from open to `subscribed`. */
  handshakeTimeoutMs?: number
  random?: () => number
}

export class RealtimeClient {
  readonly events = new Emitter<RealtimeEvents>()
  private _state: ConnectionState = 'offline'
  private socket: WebSocketLike | null = null
  private generation = 0
  private attempt = 0
  private connectedOnce = false
  private running = false
  private spaces = new Set<string>()
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null
  private lastFrameAt = 0
  private readonly url: string
  private readonly Ctor: WebSocketCtor
  private readonly o: Required<Omit<RealtimeOptions, 'WebSocket' | 'serverUrl' | 'getToken'>>

  constructor(private readonly opts: RealtimeOptions) {
    const u = new URL('/v1/ws', opts.serverUrl)
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
    this.url = u.toString()
    const Ctor = opts.WebSocket ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket
    if (!Ctor) throw new Error('no WebSocket implementation available')
    this.Ctor = Ctor
    this.o = {
      baseBackoffMs: opts.baseBackoffMs ?? 500,
      maxBackoffMs: opts.maxBackoffMs ?? 30_000,
      heartbeatMs: opts.heartbeatMs ?? 25_000,
      heartbeatTimeoutMs: opts.heartbeatTimeoutMs ?? 10_000,
      handshakeTimeoutMs: opts.handshakeTimeoutMs ?? 10_000,
      random: opts.random ?? Math.random,
    }
  }

  get state(): ConnectionState {
    return this._state
  }

  on<K extends keyof RealtimeEvents>(
    event: K,
    listener: (payload: RealtimeEvents[K]) => void,
  ): () => void {
    return this.events.on(event, listener)
  }

  /** The delay before retry number `attempt` (0-based): full exponential cap with half jitter. */
  backoffDelay(attempt: number): number {
    const exp = Math.min(this.o.maxBackoffMs, this.o.baseBackoffMs * 2 ** attempt)
    return Math.round(exp / 2 + this.o.random() * (exp / 2))
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.connectedOnce = false
    this.attempt = 0
    this.setState('connecting')
    this.open()
  }

  stop(): void {
    this.running = false
    this.teardown()
    this.setState('offline')
  }

  /** The Spaces to receive events for. Sent now when online, and again after every reconnect. */
  setSpaces(spaceIds: readonly string[]): void {
    const next = new Set(spaceIds)
    const added = [...next].some((id) => !this.spaces.has(id))
    this.spaces = next
    // The protocol has no unsubscribe; the server stops sending a Space when membership ends.
    if (added && this._state === 'online') this.sendSubscribe()
  }

  /** Drop the current connection as if the network failed; used by the UI's "retry now" too. */
  reconnectNow(): void {
    if (!this.running) return
    this.attempt = 0
    this.teardown()
    this.setState(this.connectedOnce ? 'reconnecting' : 'connecting')
    this.open()
  }

  private setState(s: ConnectionState): void {
    if (this._state === s) return
    this._state = s
    this.events.emit('state', s)
  }

  private send(frame: ClientEvent): void {
    if (this.socket && this.socket.readyState === 1) this.socket.send(JSON.stringify(frame))
  }

  private sendSubscribe(): void {
    this.send({ type: 'subscribe', spaceIds: [...this.spaces].slice(0, 100) })
  }

  private open(): void {
    const token = this.opts.getToken()
    if (!token) {
      this.running = false
      this.setState('unauthorized')
      this.events.emit('unauthorized', undefined)
      return
    }
    const gen = ++this.generation
    let ws: WebSocketLike
    try {
      ws = new this.Ctor(this.url)
    } catch {
      this.lost(gen)
      return
    }
    this.socket = ws
    this.armDeadline(gen, this.o.handshakeTimeoutMs)
    ws.addEventListener('open', () => {
      if (gen !== this.generation) return
      this.send({ type: 'auth', token })
    })
    ws.addEventListener('message', (ev: { data: unknown }) => {
      if (gen !== this.generation) return
      this.lastFrameAt = Date.now()
      this.onFrame(gen, ev.data)
    })
    ws.addEventListener('close', (ev: { code?: number }) => {
      if (gen !== this.generation) return
      if (ev.code === 4401) {
        this.running = false
        this.teardown()
        this.setState('unauthorized')
        this.events.emit('unauthorized', undefined)
        return
      }
      this.lost(gen)
    })
    ws.addEventListener('error', () => {
      // Some runtimes (Node's undici) fire `error` without a `close` for a failed handshake, so
      // the error itself counts as a lost connection. A later `close` of this socket is ignored.
      this.lost(gen)
    })
  }

  private onFrame(gen: number, data: unknown): void {
    if (typeof data !== 'string') return
    let parsed: ServerEvent
    try {
      const r = ServerEvent.safeParse(JSON.parse(data))
      if (!r.success) return
      parsed = r.data
    } catch {
      return
    }
    if (parsed.type === 'ready') {
      this.sendSubscribe()
    } else if (parsed.type === 'subscribed' && this._state !== 'online') {
      this.clearDeadline()
      this.attempt = 0
      this.startHeartbeat(gen)
      const wasReconnect = this.connectedOnce
      this.connectedOnce = true
      this.setState('online')
      this.emitEvent(parsed)
      if (wasReconnect) this.events.emit('resync', undefined)
      return
    }
    this.emitEvent(parsed)
  }

  private emitEvent(e: ServerEvent): void {
    this.events.emit(e.type, e as never)
    this.events.emit('event', e)
  }

  private startHeartbeat(gen: number): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (gen !== this.generation) return
      const pingAt = Date.now()
      this.send({ type: 'ping' })
      this.armDeadline(gen, this.o.heartbeatTimeoutMs, () => this.lastFrameAt >= pingAt)
    }, this.o.heartbeatMs)
  }

  private armDeadline(gen: number, ms: number, ok?: () => boolean): void {
    this.clearDeadline()
    this.deadlineTimer = setTimeout(() => {
      if (gen !== this.generation) return
      if (ok?.()) return
      // No answer in time: give up on this socket without waiting for a closing handshake.
      this.lost(gen)
    }, ms)
  }

  private lost(gen: number): void {
    if (gen !== this.generation) return
    this.teardown()
    if (!this.running) return
    this.setState(this.connectedOnce ? 'reconnecting' : 'connecting')
    const delay = this.backoffDelay(this.attempt++)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (this.running) this.open()
    }, delay)
  }

  private teardown(): void {
    this.generation++
    this.clearDeadline()
    this.stopHeartbeat()
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    const ws = this.socket
    this.socket = null
    if (ws && ws.readyState <= 1) {
      try {
        ws.close(1000, 'client closing')
      } catch {
        // Already closing.
      }
    }
  }

  private clearDeadline(): void {
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer)
    this.deadlineTimer = null
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }
}
