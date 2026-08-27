import { getDistributionIdentity } from './distribution-identity'

export function getOrcaCliCommandNameForPlatform(platform: NodeJS.Platform): string {
  // Why not distribution-scoped: Linux installers are official-only (downstream
  // distributions ship macOS + Windows), and `orca-ide` dodges the GNOME
  // screen-reader `orca` package name.
  if (platform === 'linux') {
    return 'orca-ide'
  }
  const publicCli = getDistributionIdentity().publicCli
  if (platform === 'win32') {
    return `${publicCli}.cmd`
  }
  return publicCli
}
