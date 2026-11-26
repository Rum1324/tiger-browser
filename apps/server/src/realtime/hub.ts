import type { ServerEvent, Thread } from '@tiger/shared'
import type { FastifyBaseLogger } from 'fastify'

/** The part of a `ws` WebSocket the hub uses; lets tests drive the hub with fakes. */
export interface SocketLike {
  readonly readyState: number
  readonly bufferedAmount: number
  send(data: string): void
  close(code?: number, reason?: string): void
  terminate(): void
}

const OPEN = 1

/**
 * A socket whose unsent buffer grows past this is not keeping up; it is cut off so it cannot pin
 * memory or delay anyone else. The client reconnects and reloads over REST.
 */
export const MAX_BUFFERED_BYTES = 1024 * 1024

export interface HubClient {
  readonly socket: SocketLike
  readonly userId: string
  readonly sessionHash: string
  readonly spaces: Set<string>
}

/**
 * In-process fan-out of server events to authenticated sockets. Space events go to that Space's
 * subscribed members; events of a private thread go only to its owner's sockets. Sending never awaits
 * a socket, so one slow client cannot block a publish.
 */
export class RealtimeHub {
  private readonly clients = new Set<HubClient>()
  private readonly bySpace = new Map<string, Set<HubClient>>()

  constructor(private readonly log: FastifyBaseLogger) {}

  add(socket: SocketLike, userId: string, sessionHash: string): HubClient {
    const client: HubClient = { socket, userId, sessionHash, spaces: new Set() }
    this.clients.add(client)
    return client
  }

  remove(client: HubClient): void {
    this.clients.delete(client)
    for (const spaceId of client.spaces) this.bySpace.get(spaceId)?.delete(client)
    client.spaces.clear()
  }

  /** Membership must be checked by the caller. */
  subscribe(client: HubClient, spaceId: string): void {
    if (!this.clients.has(client)) return
    client.spaces.add(spaceId)
    let set = this.bySpace.get(spaceId)
    if (!set) {
      set = new Set()
      this.bySpace.set(spaceId, set)
    }
    set.add(client)
  }

  /** A member left or was removed: their sockets stop receiving the Space at once. */
  dropMembership(spaceId: string, userId: string): void {
    const set = this.bySpace.get(spaceId)
    if (!set) return
    for (const client of [...set]) {
      if (client.userId === userId) {
        set.delete(client)
        client.spaces.delete(spaceId)
      }
    }
  }

  /** Logout: close every socket opened with that session. */
  closeSession(sessionHash: string): void {
    for (const client of [...this.clients]) {
      if (client.sessionHash === sessionHash) {
        this.remove(client)
        client.socket.close(4401, 'session ended')
      }
    }
  }

  publishToSpace(spaceId: string, event: ServerEvent): void {
    this.fanOut(spaceId, event, null)
  }

  publishToUser(spaceId: string, userId: string, event: ServerEvent): void {
    this.fanOut(spaceId, event, userId)
  }

  /** Routes a thread's event by its visibility. */
  publishForThread(
    thread: Pick<Thread, 'spaceId' | 'visibility'> & { ownerId: string },
    event: ServerEvent,
  ): void {
    if (thread.visibility === 'private') this.publishToUser(thread.spaceId, thread.ownerId, event)
    else this.publishToSpace(thread.spaceId, event)
  }

  send(client: HubClient, event: ServerEvent): void {
    this.sendRaw(client, JSON.stringify(event))
  }

  closeAll(): void {
    for (const client of [...this.clients]) {
      this.remove(client)
      client.socket.close(1001, 'server shutting down')
    }
  }

  get clientCount(): number {
    return this.clients.size
  }

  private fanOut(spaceId: string, event: ServerEvent, onlyUserId: string | null): void {
    const set = this.bySpace.get(spaceId)
    if (!set || set.size === 0) return
    const data = JSON.stringify(event)
    for (const client of [...set]) {
      if (onlyUserId !== null && client.userId !== onlyUserId) continue
      this.sendRaw(client, data)
    }
  }

  private sendRaw(client: HubClient, data: string): void {
    const { socket } = client
    if (socket.readyState !== OPEN) {
      this.remove(client)
      return
    }
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.log.warn({ userId: client.userId }, 'websocket too slow, terminating')
      this.remove(client)
      socket.terminate()
      return
    }
    try {
      socket.send(data)
    } catch (err) {
      this.log.warn({ err, userId: client.userId }, 'websocket send failed, terminating')
      this.remove(client)
      socket.terminate()
    }
  }
}
