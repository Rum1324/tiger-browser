import { ClientEvent, type ServerEvent } from '@tiger/shared'
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { resolveSession } from '../auth/sessions'
import type { HubClient, RealtimeHub } from './hub'

/** A socket that has not authenticated by then is closed. */
export const AUTH_TIMEOUT_MS = 10_000
const MAX_FRAME_BYTES = 64 * 1024

/**
 * Subscribe `client` to those of `ids` the user is a member of, as `lookup` reports. Returns the ids
 * subscribed to.
 */
export async function subscribeMember(
  hub: RealtimeHub,
  client: HubClient,
  ids: string[],
  lookup: (ids: string[]) => Promise<string[]>,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  // Read before the lookup: a removal that commits while it runs bumps the epoch, so a membership
  // row the lookup saw just before the removal cannot subscribe a socket the removal already dropped.
  const epochs = new Map(ids.map((id) => [id, hub.membershipEpoch(id, client.userId)]))
  const found = await lookup(ids)
  const allowed = new Set<string>()
  for (const id of found) if (hub.subscribe(client, id, epochs.get(id) ?? 0)) allowed.add(id)
  return allowed
}

/**
 * `/v1/ws`: the first frame must be `auth`. After `ready`, `subscribe` adds the Spaces the user is a
 * member of; ids that are not are reported in one generic error, never distinguished from unknown ids.
 * `unsubscribe` removes Spaces silently; a following `ping` confirms it took effect.
 */
export function websocketRoute(app: FastifyInstance): void {
  const { sql, hub, log, config } = app.tiger

  const sessionValid = async (hashHex: string) =>
    (
      await sql`
        select 1 from sessions
        where token_hash = ${Buffer.from(hashHex, 'hex')}::bytea and expires_at > now()
      `
    ).length > 0

  app.get('/v1/ws', { websocket: true }, (socket: WebSocket) => {
    let client: HubClient | null = null
    let alive = true
    // Frames are handled one at a time so a `ping` sent after `subscribe` is answered after it.
    let queue: Promise<void> = Promise.resolve()

    const sendDirect = (event: ServerEvent) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event))
    }
    const authTimer = setTimeout(() => {
      if (!client) socket.close(4401, 'authentication timeout')
    }, AUTH_TIMEOUT_MS)
    // Protocol-level ping every config.wsHeartbeatMs; a socket that misses one pong is dead. Each beat
    // also checks that the socket's session still exists and has not expired.
    let checking = false
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate()
        return
      }
      alive = false
      socket.ping()
      const current = client
      if (!current || checking) return
      checking = true
      void sessionValid(current.sessionHash)
        .then((valid) => {
          if (!valid) hub.closeClient(current, 4401, 'session ended')
        })
        .catch((err) => log.warn({ err }, 'websocket session check failed'))
        .finally(() => {
          checking = false
        })
    }, config.wsHeartbeatMs)
    socket.on('pong', () => {
      alive = true
    })

    socket.on('close', () => {
      clearTimeout(authTimer)
      clearInterval(heartbeat)
      if (client) hub.remove(client)
      client = null
    })
    socket.on('error', (err) => log.debug({ err }, 'websocket error'))

    socket.on('message', (raw, isBinary) => {
      alive = true
      queue = queue
        .then(async () => {
          const text = isBinary ? null : raw.toString()
          if (text === null || text.length > MAX_FRAME_BYTES) {
            sendDirect({
              type: 'error',
              code: 'invalid_frame',
              message: 'Frames must be JSON text',
            })
            return
          }
          let frame: ClientEvent
          try {
            const parsed = ClientEvent.safeParse(JSON.parse(text))
            if (!parsed.success) throw new Error('bad frame')
            frame = parsed.data
          } catch {
            sendDirect({ type: 'error', code: 'invalid_frame', message: 'Unrecognised frame' })
            return
          }

          if (!client) {
            if (frame.type !== 'auth') {
              socket.close(4401, 'authenticate first')
              return
            }
            const session = await resolveSession(sql, frame.token)
            if (!session || socket.readyState !== socket.OPEN) {
              socket.close(4401, 'invalid session')
              return
            }
            clearTimeout(authTimer)
            client = hub.add(socket, session.user.id, session.tokenHash.toString('hex'))
            hub.send(client, { type: 'ready', userId: session.user.id })
            return
          }

          switch (frame.type) {
            case 'auth':
              sendDirect({
                type: 'error',
                code: 'already_authenticated',
                message: 'Already signed in',
              })
              return
            case 'ping':
              hub.send(client, { type: 'pong' })
              return
            case 'subscribe': {
              const current = client
              const ids = [...new Set(frame.spaceIds)]
              const allowed = await subscribeMember(hub, current, ids, async (spaceIds) =>
                (
                  await sql<{ space_id: string }[]>`
                    select space_id from space_members
                    where user_id = ${current.userId} and space_id = any(${spaceIds}::uuid[])
                  `
                ).map((r) => r.space_id),
              )
              hub.send(current, {
                type: 'subscribed',
                spaceIds: ids.filter((id) => allowed.has(id)),
              })
              if (allowed.size < ids.length) {
                hub.send(current, {
                  type: 'error',
                  code: 'subscribe_denied',
                  message: `${ids.length - allowed.size} Space(s) not found`,
                })
              }
              return
            }
            case 'unsubscribe': {
              // No membership check is needed to stop receiving; unknown ids are simply ignored.
              for (const id of new Set(frame.spaceIds)) hub.unsubscribe(client, id)
              return
            }
          }
        })
        .catch((err) => {
          log.error({ err }, 'websocket frame handling failed')
          socket.close(1011, 'internal error')
        })
    })
  })
}
