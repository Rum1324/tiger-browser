import { ModelRef } from '@tiger/shared'
import { z } from 'zod'
import type { Config } from '../config'

const optional = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()))

const modelRef = optional.transform((v, ctx) => {
  if (v === undefined) return undefined
  const slash = v.indexOf('/')
  const parsed = ModelRef.safeParse({ provider: v.slice(0, slash), id: v.slice(slash + 1) })
  if (slash <= 0 || !parsed.success) {
    ctx.addIssue({
      code: 'custom',
      message: 'must be provider/model-id, e.g. anthropic/claude-sonnet-5-5',
    })
    return z.NEVER
  }
  return parsed.data
})

const flag = z.enum(['0', '1', '']).optional()

const Schema = z.object({
  /** provider/id of the model new answers use when the client names none. */
  CHAT_DEFAULT_MODEL: modelRef,
  /** provider/id of the model that writes thread titles; default: the cheapest available. */
  CHAT_TITLE_MODEL: modelRef,
  /** 1 = always offer the offline mock model, 0 = never; unset = only without any provider key outside production. */
  CHAT_ENABLE_MOCK: flag,
  /** 0 turns generated thread titles off. */
  CHAT_THREAD_TITLES: flag,
})

export interface ChatConfig {
  defaultModel: ModelRef | null
  titleModel: ModelRef | null
  enableMock: boolean
  generateTitles: boolean
  providerKeys: Config['providerKeys']
}

/** Chat settings from the environment; errors name variables, never values. */
export function loadChatConfig(
  config: Pick<Config, 'env' | 'providerKeys'>,
  env: Record<string, string | undefined> = process.env,
): ChatConfig {
  const parsed = Schema.safeParse(env)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new Error(`invalid chat configuration\n${lines.join('\n')}`)
  }
  const c = parsed.data
  const keys = config.providerKeys
  const anyKey = Boolean(keys.anthropic || keys.openai || keys.gemini)
  // The mock keeps the product usable offline in development; production never gets it implicitly.
  const enableMock =
    c.CHAT_ENABLE_MOCK === '1' ||
    (c.CHAT_ENABLE_MOCK !== '0' && !anyKey && config.env !== 'production')
  return {
    defaultModel: c.CHAT_DEFAULT_MODEL ?? null,
    titleModel: c.CHAT_TITLE_MODEL ?? null,
    enableMock,
    generateTitles: c.CHAT_THREAD_TITLES !== '0',
    providerKeys: keys,
  }
}
