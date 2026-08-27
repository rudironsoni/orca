import type { UpdateStatus } from '../shared/update-status-types'
import { getDistributionIdentity } from '../shared/distribution-identity'

/**
 * The single update-capability gate for downstream distributions (Horca).
 * When the active distribution disables the updater, no updater path may
 * contact the official Orca release feed, onorca.dev nudge/changelog services,
 * or the electron-updater machinery — updates ship via Homebrew/GitHub
 * Releases instead. Official builds always pass this gate unchanged.
 */
export function isInAppUpdaterEnabled(): boolean {
  return getDistributionIdentity().updaterEnabled
}

/**
 * The deliberate "updates are disabled for this distribution" status. A plain
 * 'not-available' would imply a completed feed check; an 'error' would imply a
 * network failure. The reason field lets the renderer explain where updates
 * actually come from.
 */
export function getUpdatesDisabledStatus(userInitiated?: boolean): UpdateStatus {
  return {
    state: 'not-available',
    ...(userInitiated === undefined ? {} : { userInitiated }),
    updatesDisabledReason: 'downstream-distribution'
  }
}
