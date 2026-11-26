import { api } from '@tiger/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiClient, createTigerClient } from '../src'
import { makeClient, waitFor } from './helpers/client'
import { FakeBridge } from './helpers/fake-bridge'
import { startServer, type TestServer } from './helpers/server'

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(async () => {
  await server.close()
})

describe('session edge cases', () => {
  it('booting offline keeps the stored token and reports offline', async () => {
    const bridge = new FakeBridge()
    bridge.token = 'stored-token-that-cannot-be-checked'
    const client = createTigerClient({ serverUrl: 'http://127.0.0.1:9', bridge })
    await client.start()
    expect(client.session.store.getState()).toMatchObject({ status: 'offline' })
    expect(client.session.store.getState().error?.kind).toBe('network')
    expect(bridge.token).toBe('stored-token-that-cannot-be-checked')
    client.dispose()
  })

  it('a dev login refused by the server leaves the member signed out with the error', async () => {
    const C = makeClient(server.url)
    await C.client.start()
    await C.client.session.devLogin('not-an-email', 'X')
    expect(C.client.session.store.getState()).toMatchObject({ status: 'signedOut' })
    expect(C.client.session.store.getState().error?.code).toBe('invalid_request')
    expect(C.bridge.token).toBeNull()
    C.client.dispose()
  })

  it('a session ended elsewhere signs the client out (socket 4401, then the 401 on /me)', async () => {
    const C = makeClient(server.url)
    await C.client.start()
    await C.client.session.devLogin('ended@example.com', 'Ended')
    await waitFor(() => C.client.ui.getState().connection === 'online')
    // The same session is logged out from another place.
    const token = C.bridge.token
    await createApiClient({ serverUrl: server.url, getToken: () => token }).call(api.authLogout, {})
    await waitFor(
      () => C.client.session.store.getState().status === 'signedOut',
      5000,
      'signed out',
    )
    expect(C.bridge.token).toBeNull()
    expect(C.client.ui.getState().connection).toBe('offline')
    C.client.dispose()
  })

  it('locale follows the engine settings', async () => {
    const C = makeClient(server.url)
    C.bridge.settings.locale = 'en'
    await C.client.start()
    expect(C.client.t()('connection.online')).toBe('Connected.')
    await C.bridge.invoke('settings.update', { locale: 'ja' })
    expect(C.client.t()('connection.online')).toBe('接続しました。')
    C.client.dispose()
  })
})
