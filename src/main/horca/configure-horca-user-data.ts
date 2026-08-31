import { app } from 'electron'
import { getDistributionIdentity } from '../../shared/distribution-identity'
import { getLocalStateRoot } from '../local-state-root'

// Probe string for packaged asar checks. Minify drops unused identifiers.
export const HORCA_PACKAGED_ELECTRON_PROFILE = 'horca-packaged-electron-profile'

export function configureHorcaUserDataPath(isDev: boolean): void {
  const identity = getDistributionIdentity()
  if (isDev || identity.distribution !== 'horca') {
    return
  }

  app.setPath('userData', getLocalStateRoot(app.getPath('home')))
  ;(globalThis as Record<string, unknown>)[HORCA_PACKAGED_ELECTRON_PROFILE] = true
}
