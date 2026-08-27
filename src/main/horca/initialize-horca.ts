import type { Store } from '../persistence'
import { electronHerdrDesktopSurface } from './terminal-backend/electron-herdr-desktop-surface'
import { setHerdrDesktopSurface } from './terminal-backend/herdr-desktop-surface'
import { registerHerdrTerminalBackend } from './terminal-backend/register-herdr-terminal-backend'

export type HorcaRegistration = {
  dispose(): void
}

export function initializeHorca(store: Store): HorcaRegistration {
  setHerdrDesktopSurface(electronHerdrDesktopSurface)
  const unregisterHerdr = registerHerdrTerminalBackend(store)
  return {
    dispose: () => {
      unregisterHerdr()
      setHerdrDesktopSurface(null)
    }
  }
}
