import { getDistributionIdentity } from './distribution-identity'

export type DownstreamUpdateCopyKind = 'card' | 'settings' | 'aria'

/**
 * Horca-only product copy lives here instead of locale JSON. Overlaying
 * `en.json` (and the other catalogs) is what made Shepherd conflict every
 * time upstream touched translations; `translate()` fallbacks would still
 * require those keys in the English catalog.
 */
export function downstreamMinimizeToTrayNotice(): { title: string; body: string } {
  const productName = getDistributionIdentity().productName
  return {
    title: productName,
    body: `${productName} is still running in the system tray`
  }
}

export function downstreamUpdatesDisabledCopy(kind: DownstreamUpdateCopyKind): string {
  const productName = getDistributionIdentity().productName
  switch (kind) {
    case 'card':
      return `Updates for ${productName} ship through Homebrew and GitHub Releases.`
    case 'settings':
      return `In-app updates are disabled for ${productName} builds. Install updates through Homebrew or from GitHub Releases.`
    case 'aria':
      return `Updates for ${productName} ship through Homebrew and GitHub Releases.`
  }
}
