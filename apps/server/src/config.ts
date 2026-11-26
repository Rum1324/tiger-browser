import { z } from 'zod'

/** Empty strings in an env file mean "not set". */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()))

const optionalPositiveInt = optionalString.pipe(
  z.coerce.number<string | undefined>().int().positive().optional(),
)

const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(0).max(65535).default(8787),
    PUBLIC_URL: z.url().default('http://localhost:8787'),
    CORS_ORIGINS: z
      .string()
      .default('tiger://ui')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    AUTH_DEV_LOGIN: z
      .enum(['0', '1', ''])
      .default('0')
      .transform((v) => v === '1'),
    GOOGLE_OAUTH_CLIENT_ID: optionalString,
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    SPACE_TOKEN_BUDGET: optionalPositiveInt,
    AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),
    SHARE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(30),
    WS_HEARTBEAT_MS: z.coerce.number().int().min(50).default(30_000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    ANTHROPIC_API_KEY: optionalString,
    OPENAI_API_KEY: optionalString,
    GEMINI_API_KEY: optionalString,
  })
  .refine((c) => !(c.NODE_ENV === 'production' && c.AUTH_DEV_LOGIN), {
    message: 'AUTH_DEV_LOGIN=1 is not allowed when NODE_ENV=production',
    path: ['AUTH_DEV_LOGIN'],
  })

export interface Config {
  env: 'development' | 'test' | 'production'
  databaseUrl: string
  host: string
  port: number
  publicUrl: string
  corsOrigins: string[]
  devLogin: boolean
  googleClientId: string | null
  sessionTtlDays: number
  /** Budget stored on each new Space; null = unlimited. */
  spaceTokenBudget: number | null
  authRateLimitPerMinute: number
  /** Shares (new items and new versions) per member per minute; each one queues embedding work. */
  shareRateLimitPerMinute: number
  /** WebSocket ping cadence; each beat also re-checks the socket's session. */
  wsHeartbeatMs: number
  logLevel: string
  /** Passed through untouched for the chat agent. Never logged, never returned to clients. */
  providerKeys: { anthropic: string | null; openai: string | null; gemini: string | null }
}

export class ConfigError extends Error {}

/**
 * Parse configuration from an environment map. The error lists variable names and problems only,
 * never values, so a malformed secret cannot end up in a log.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = ConfigSchema.safeParse(env)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new ConfigError(`invalid configuration\n${lines.join('\n')}`)
  }
  const c = parsed.data
  return {
    env: c.NODE_ENV,
    databaseUrl: c.DATABASE_URL,
    host: c.HOST,
    port: c.PORT,
    publicUrl: c.PUBLIC_URL.replace(/\/$/, ''),
    corsOrigins: c.CORS_ORIGINS,
    devLogin: c.AUTH_DEV_LOGIN,
    googleClientId: c.GOOGLE_OAUTH_CLIENT_ID ?? null,
    sessionTtlDays: c.SESSION_TTL_DAYS,
    spaceTokenBudget: c.SPACE_TOKEN_BUDGET ?? null,
    authRateLimitPerMinute: c.AUTH_RATE_LIMIT_PER_MINUTE,
    shareRateLimitPerMinute: c.SHARE_RATE_LIMIT_PER_MINUTE,
    wsHeartbeatMs: c.WS_HEARTBEAT_MS,
    logLevel: c.LOG_LEVEL,
    providerKeys: {
      anthropic: c.ANTHROPIC_API_KEY ?? null,
      openai: c.OPENAI_API_KEY ?? null,
      gemini: c.GEMINI_API_KEY ?? null,
    },
  }
}
