import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../src/config'

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' }

describe('loadConfig', () => {
  it('applies defaults and parses lists and flags', () => {
    const c = loadConfig({
      ...base,
      CORS_ORIGINS: 'tiger://ui, http://localhost:5173',
      AUTH_DEV_LOGIN: '1',
    })
    expect(c.corsOrigins).toEqual(['tiger://ui', 'http://localhost:5173'])
    expect(c.devLogin).toBe(true)
    expect(c.port).toBe(8787)
    expect(c.sessionTtlDays).toBe(30)
    expect(c.spaceTokenBudget).toBeNull()
    expect(c.googleClientId).toBeNull()
  })

  it('treats empty values as unset and passes provider keys through untouched', () => {
    const c = loadConfig({
      ...base,
      SPACE_TOKEN_BUDGET: '',
      GOOGLE_OAUTH_CLIENT_ID: '',
      ANTHROPIC_API_KEY: 'sk-ant-xyz',
      SESSION_TTL_DAYS: '7',
    })
    expect(c.spaceTokenBudget).toBeNull()
    expect(c.googleClientId).toBeNull()
    expect(c.providerKeys).toEqual({ anthropic: 'sk-ant-xyz', openai: null, gemini: null })
    expect(c.sessionTtlDays).toBe(7)
    expect(loadConfig({ ...base, SPACE_TOKEN_BUDGET: '5000' }).spaceTokenBudget).toBe(5000)
  })

  it('refuses dev login in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', AUTH_DEV_LOGIN: '1' })).toThrow(
      ConfigError,
    )
  })

  it('names bad variables without echoing their values', () => {
    try {
      loadConfig({ DATABASE_URL: 'mysql://secret-password@host/db', PORT: 'abc' })
      expect.unreachable()
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).toContain('DATABASE_URL')
      expect(msg).toContain('PORT')
      expect(msg).not.toContain('secret-password')
    }
  })
})
