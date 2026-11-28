import type { EngineBridge, Settings } from '@tiger/shared'
import { useEffect, useMemo, useState } from 'react'
import { useThemeEffect } from '../app/useTheme'
import { translator } from '../i18n'
import { createOverlayGuest, type OverlayGuest } from './guest'
import { OverlayRoot } from './OverlayRoot'
import { Placeholder } from './placeholders'
import type { GuestTransport } from './protocol'

/**
 * The overlay view's root (the same bundle loaded with #overlay). It has its own engine bridge but
 * no @tiger/client: what a surface needs from the client arrives as props from the main view, and
 * what it decides goes back as a result or an event. Theme and locale follow the engine settings.
 */
export function OverlayApp({
  bridge,
  transport,
}: {
  bridge: EngineBridge
  /** The channel to the main view of this window; needs the window id, so it is made after tabs.get. */
  transport: (windowId: string) => GuestTransport
}) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [guest, setGuest] = useState<OverlayGuest | null>(null)

  useEffect(() => {
    let live = true
    const off = bridge.on('settings.changed', setSettings)
    bridge.invoke('settings.get').then((s) => live && setSettings(s), () => {})
    let g: OverlayGuest | null = null
    bridge.invoke('tabs.get').then(
      (t) => {
        if (!live) return
        g = createOverlayGuest(transport(t.windowId))
        setGuest(g)
      },
      () => {},
    )
    return () => {
      live = false
      off()
      g?.dispose()
    }
  }, [bridge, transport])

  useThemeEffect(settings?.theme ?? 'system')
  const t = useMemo(() => translator(settings?.locale ?? 'ja'), [settings?.locale])
  if (!guest) return null
  return <OverlayRoot guest={guest} fallback={(name) => <Placeholder name={name} t={t} bridge={bridge} />} />
}
