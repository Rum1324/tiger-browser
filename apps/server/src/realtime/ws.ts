import { ClientEvent, type ServerEvent } from '@tiger/shared'
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { resolveSession } from '../auth/sessions'
import type { HubClient } from './hub'

/** A socket that has not authenticated by then is closed. */
export const AUTH_TIMEOUT_MS = 10_000
/** Protocol-level ping cadence; a socket that misses one pong is considered dead. */
export const HEARTBEAT_MS = 30_000
const MAX_FRAME_BYTES = 64 * 1024

/**
 * `/v1/ws`: the first frame must be `auth`. After `ready`, `subscribe` adds the Spaces the user is a
 * member of; ids that are not are reported in one generic error, never distinguished from unknown ids.
 */
export function websocketRoute(app: FastifyInstance): void {
  const { sql, hub, log } = app.tiger

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
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate()
        return
      }
      alive = false
      socket.ping()
    }, HEARTBEAT_MS)
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
              const rows =
                ids.length === 0
                  ? []
                  : await sql<{ space_id: string }[]>`
                    select space_id from space_members
                    where user_id = ${current.userId} and space_id = any(${ids}::uuid[])
                  `
              const allowed = new Set(rows.map((r) => r.space_id))
              for (const id of allowed) hub.subscribe(current, id)
              if (allowed.size < ids.length) {
                hub.send(current, {
                  type: 'error',
                  code: 'subscribe_denied',
                  message: `${ids.length - allowed.size} Space(s) not found`,
                })
              }
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
