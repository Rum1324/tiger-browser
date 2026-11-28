import type { ShortcutAction } from '@tiger/shared'
import { useEffect, useRef } from 'react'
import { useServices } from './context'

/**
 * Take a menu shortcut over while this component is mounted (and `enabled`); the previous handler
 * gets it back afterwards. The handler may change on every render without re-registering.
 */
export function useShortcut(action: ShortcutAction, handler: () => void, enabled = true): void {
  const { shortcuts } = useServices()
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!enabled) return
    return shortcuts.on(action, () => ref.current())
  }, [shortcuts, action, enabled])
}
