import { createTigerClient } from '@tiger/client'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import type { AppBoot } from './app/boot'
import { localPrefsStorage } from './app/prefs'
import { OverlayApp } from './overlay/OverlayApp'
import {
  broadcastTransport,
  channelName,
  type GuestMessage,
  type HostMessage,
} from './overlay/protocol'
import './theme'

// One bundle, two entry routes: the main UI view and the overlay view (loaded with #overlay).
const isOverlay = location.hash === '#overlay'
document.documentElement.dataset.view = isOverlay ? 'overlay' : 'main'

const bridge = window.tiger

const boot: AppBoot = {
  bridge,
  createClient: (serverUrl) => createTigerClient({ serverUrl, bridge }),
  hostTransport: (windowId) =>
    broadcastTransport<HostMessage, GuestMessage>('host', new BroadcastChannel(channelName(windowId))),
  prefs: localPrefsStorage(),
}

const guestTransport = (windowId: string) =>
  broadcastTransport<GuestMessage, HostMessage>('guest', new BroadcastChannel(channelName(windowId)))

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      {isOverlay ? <OverlayApp bridge={bridge} transport={guestTransport} /> : <App boot={boot} />}
    </StrictMode>,
  )
}
