import { app } from 'electron'
import { getDistributionIdentity } from '../../shared/distribution-identity'
import { getLocalStateRoot } from '../local-state-root'

export function configureHorcaUserDataPath(isDev: boolean): void {
  const identity = getDistributionIdentity()
  if (isDev || identity.distribution !== 'horca') {
    return
  }

  app.setPath('userData', getLocalStateRoot(app.getPath('home')))
}
