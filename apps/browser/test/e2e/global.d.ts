import type { EngineBridge } from '@tiger/shared'

declare global {
  interface Window {
    tiger: EngineBridge
  }
}
