import type { Settings } from '@tiger/shared'
import { useEffect, useState } from 'react'
import { strings } from './i18n'

/**
 * The overlay view's route. While open it takes every click inside its bounds; the counter makes
 * that visible (and checkable) in the harness.
 */
export function Overlay() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [clicks, setClicks] = useState(0)
  const t = strings(settings?.locale ?? 'en')

  useEffect(() => {
    window.tiger.invoke('settings.get').then(setSettings)
    const off = window.tiger.on('settings.changed', setSettings)
    const onClick = () => setClicks((n) => n + 1)
    document.addEventListener('mousedown', onClick)
    return () => {
      off()
      document.removeEventListener('mousedown', onClick)
    }
  }, [])

  return (
    <div className="overlay-card">
      <strong>{t.overlayTitle}</strong>
      <p data-testid="overlay-clicks">{clicks}</p>
      <button type="button" onClick={() => window.tiger.invoke('overlay.setOpen', { open: false })}>
        {t.closeOverlay}
      </button>
    </div>
  )
}
