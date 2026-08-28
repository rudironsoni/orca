import type { Store } from '../persistence'
import { electronHerdrDesktopSurface } from './terminal-backend/electron-herdr-desktop-surface'
import { setHerdrDesktopSurface } from './terminal-backend/herdr-desktop-surface'
import { registerHerdrTerminalBackend } from './terminal-backend/register-herdr-terminal-backend'
import {
  createHorcaTerminalSettingsSource,
  horcaTerminalSettingsPath
} from './terminal-backend/horca-terminal-settings'
import { registerHorcaTerminalSettingsIpc } from './terminal-backend/horca-terminal-settings-ipc'

export type HorcaRegistration = {
  dispose(): void
}

export function initializeHorca(store: Store): HorcaRegistration {
  setHerdrDesktopSurface(electronHerdrDesktopSurface)
  const settings = createHorcaTerminalSettingsSource(store, horcaTerminalSettingsPath())
  const unregisterHerdr = registerHerdrTerminalBackend(store, settings)
  const unregisterSettingsIpc = registerHorcaTerminalSettingsIpc(settings)
  return {
    dispose: () => {
      unregisterSettingsIpc()
      unregisterHerdr()
      setHerdrDesktopSurface(null)
    }
  }
}
