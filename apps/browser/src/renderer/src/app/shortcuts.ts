import type { EngineBridge, ShortcutAction } from '@tiger/shared'

export type ShortcutHandler = () => void

/**
 * The application menu's shortcut events (the engine owns the accelerators and sends `shortcut`)
 * dispatched to whoever registered for the action. Handlers stack: the latest registration wins
 * while it is active (a focused surface can take over `find` or `toggle-command`), and removing it
 * gives the action back to the previous handler.
 */
export interface Shortcuts {
  on(action: ShortcutAction, handler: ShortcutHandler): () => void
  /** Run the current handler of an action; false when nobody handles it. */
  dispatch(action: ShortcutAction): boolean
  /** Follow the engine's `shortcut` events. Returns the unsubscribe. */
  attach(bridge: Pick<EngineBridge, 'on'>): () => void
  handled(action: ShortcutAction): boolean
}

export function createShortcuts(): Shortcuts {
  const stacks = new Map<ShortcutAction, ShortcutHandler[]>()
  const self: Shortcuts = {
    on(action, handler) {
      const stack = stacks.get(action) ?? []
      // A distinct wrapper per registration, so the same function registered twice is removed once.
      const entry: ShortcutHandler = () => handler()
      stack.push(entry)
      stacks.set(action, stack)
      return () => {
        const s = stacks.get(action)
        if (!s) return
        const i = s.lastIndexOf(entry)
        if (i !== -1) s.splice(i, 1)
      }
    },
    dispatch(action) {
      const h = stacks.get(action)?.at(-1)
      if (!h) return false
      h()
      return true
    },
    attach(bridge) {
      return bridge.on('shortcut', ({ action }) => {
        self.dispatch(action)
      })
    },
    handled: (action) => (stacks.get(action)?.length ?? 0) > 0,
  }
  return self
}
