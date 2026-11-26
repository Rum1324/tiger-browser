import type { ApiError } from '@tiger/shared'
import type { FastifyError, FastifyInstance } from 'fastify'
import { AppError, type ErrorCode } from '../errors'

const body = (code: ErrorCode, message: string): ApiError => ({ error: { code, message } })

/** Every failure leaves as the contract's ApiError shape with a stable code. */
export function installErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | AppError | Error, req, reply) => {
    if (err instanceof AppError) {
      if (err.status >= 500) req.log.error({ err }, err.message)
      return reply.status(err.status).send(body(err.code, err.message))
    }
    const status = 'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500
    if (status === 429) {
      return reply.status(429).send(body('rate_limited', 'Too many requests, retry later'))
    }
    if (status === 413) {
      return reply.status(413).send(body('payload_too_large', 'Request body is too large'))
    }
    if (status >= 400 && status < 500) {
      // Fastify's own client errors (malformed JSON, wrong content type): the message carries no data.
      return reply.status(status).send(body('invalid_request', err.message))
    }
    req.log.error({ err }, 'unhandled error')
    return reply.status(500).send(body('internal', 'Internal server error'))
  })

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send(body('not_found', 'No such route'))
  })
}
