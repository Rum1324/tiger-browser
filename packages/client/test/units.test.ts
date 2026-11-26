import { type ApiRouteName, api, type ModelInfo } from '@tiger/shared'
import { describe, expect, it } from 'vitest'
import { type ApiClient, answerToMarkdown, parseInviteToken, sha256Hex } from '../src'
import type { ClientContext } from '../src/load'
import { createModels } from '../src/stores/models'
import { FakeBridge } from './helpers/fake-bridge'

/** An ApiClient answering from per-route handlers, recording each call by route name. */
function fakeApi(handlers: Partial<Record<ApiRouteName, (input: unknown) => unknown>>) {
  const names = new Map<unknown, ApiRouteName>(
    (Object.keys(api) as ApiRouteName[]).map((n) => [api[n], n]),
  )
  const calls: ApiRouteName[] = []
  const client: ApiClient = {
    serverUrl: 'http://x.test',
    call: (async (route: unknown, input: unknown) => {
      const name = names.get(route) as ApiRouteName
      calls.push(name)
      const h = handlers[name]
      if (!h) throw new Error(`unexpected call ${name}`)
      return h(input)
    }) as ApiClient['call'],
  }
  return { client, calls }
}

const model = (provider: ModelInfo['provider'], id: string, available = true): ModelInfo => ({
  provider,
  id,
  label: id,
  tier: 'balanced',
  contextWindow: 200_000,
  available,
})

describe('models', () => {
  const catalogue = {
    models: [
      model('anthropic', 'claude-a'),
      model('openai', 'gpt-b'),
      model('google', 'gem-c', false),
      model('mock', 'mock-chat'),
    ],
    defaultModel: { provider: 'anthropic' as const, id: 'claude-a' },
  }

  it('selects the member default from settings, falls back to the server default, and names the provider company', async () => {
    const bridge = new FakeBridge()
    bridge.settings.defaultModel = { provider: 'openai', id: 'gpt-b' }
    const { client } = fakeApi({ listModels: () => catalogue })
    const ctx: ClientContext = { api: client, bridge, userId: () => null }
    const models = createModels(ctx)
    await models.load()
    expect(models.store.getState().load.status).toBe('ready')
    expect(models.selectedInfo()).toMatchObject({ provider: 'openai', company: 'OpenAI' })

    // A per-message choice is used once, then the default comes back.
    models.select({ provider: 'anthropic', id: 'claude-a' })
    expect(models.selectedInfo()?.company).toBe('Anthropic')
    models.consumeSelection()
    expect(models.selectedInfo()?.provider).toBe('openai')

    // Unavailable models cannot be selected or made default.
    models.select({ provider: 'google', id: 'gem-c' })
    expect(models.selectedInfo()?.provider).toBe('openai')
    await models.setDefault({ provider: 'google', id: 'gem-c' })
    expect(bridge.settings.defaultModel).toEqual({ provider: 'openai', id: 'gpt-b' })

    await models.setDefault({ provider: 'mock', id: 'mock-chat' })
    expect(bridge.settings.defaultModel).toEqual({ provider: 'mock', id: 'mock-chat' })
    expect(models.selectedInfo()).toMatchObject({ provider: 'mock', company: null })

    await models.setDefault(null)
    expect(bridge.settings.defaultModel).toBeNull()
    expect(models.selectedInfo()?.provider).toBe('anthropic')
  })

  it('reports an error state when the catalogue cannot be loaded', async () => {
    const { client } = fakeApi({})
    const models = createModels({ api: client, bridge: new FakeBridge(), userId: () => null })
    await models.load()
    expect(models.store.getState().load.status).toBe('error')
  })
})

describe('invite links', () => {
  const token = 'AbCdEf0123456789_-xyzAbCdEf0123456789_-xyz'
  it('accepts the server link, a ?token= link, or the bare token', () => {
    expect(parseInviteToken(`https://tiger.test/invite#${token}`)).toBe(token)
    expect(parseInviteToken(`  https://tiger.test/invite?token=${token}\n`)).toBe(token)
    expect(parseInviteToken(token)).toBe(token)
  })
  it('rejects things that are not tokens', () => {
    expect(parseInviteToken('')).toBeNull()
    expect(parseInviteToken('hello there')).toBeNull()
    expect(parseInviteToken('https://tiger.test/invite#')).toBeNull()
  })
})

describe('content hash and Markdown export', () => {
  it('matches the server digest (sha256 hex of UTF-8)', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(await sha256Hex('日本語')).toBe(
      '77710aedc74ecfa33685e33a6c7df5cc83004da1bdcef7fb280f5c2b2e97e0a5',
    )
  })
  it('lists sources so [n] markers still resolve, and marks unshared ones', () => {
    const md = answerToMarkdown(
      'Answer [1] [2]',
      [
        {
          n: 2,
          itemId: 'i2',
          itemVersionId: 'v2',
          title: 'Two',
          url: 'https://two',
          sourceType: 'web',
          sharedBy: { id: 'u', name: 'A', avatarUrl: null },
          sharedAt: '2026-01-01T00:00:00Z',
          quote: '',
          available: false,
        },
        {
          n: 1,
          itemId: 'i1',
          itemVersionId: 'v1',
          title: 'One',
          url: 'https://one',
          sourceType: 'web',
          sharedBy: { id: 'u', name: 'A', avatarUrl: null },
          sharedAt: '2026-01-01T00:00:00Z',
          quote: 'q',
          available: true,
        },
      ],
      '出典',
    )
    expect(md).toBe(
      'Answer [1] [2]\n\n## 出典\n\n[1] One <https://one>\n[2] Two <https://two> (unshared)\n',
    )
  })
})
