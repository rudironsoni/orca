import type { Store } from '../persistence'
import { electronHerdrDesktopSurface } from './terminal-backend/electron-herdr-desktop-surface'
import { setHerdrDesktopSurface } from './terminal-backend/herdr-desktop-surface'
import { registerHerdrTerminalBackend } from './terminal-backend/register-herdr-terminal-backend'
import {
  createHorcaTerminalSettingsSource,
  horcaTerminalSettingsPath
} from './terminal-backend/horca-terminal-settings'

export type HorcaRegistration = {
  dispose(): void
}

export function initializeHorca(store: Store, profileDataFile: string): HorcaRegistration {
  setHerdrDesktopSurface(electronHerdrDesktopSurface)
  const settings = createHorcaTerminalSettingsSource(
    store,
    horcaTerminalSettingsPath(profileDataFile)
  )
  const unregisterHerdr = registerHerdrTerminalBackend(store, settings)
  return {
    dispose: () => {
      unregisterHerdr()
      setHerdrDesktopSurface(null)
    }
  }
}
