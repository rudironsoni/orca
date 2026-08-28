/**
 * Distribution identity for this build of the app.
 *
 * Orca supports downstream personal distributions that install side by side
 * with official Orca (fork-only; see docs/FORK_MAINTENANCE.md). Every
 * externally visible identity — product name, bundle id, URL protocol, public
 * CLI command, local state root — must resolve from this one definition so the
 * two apps never collide on OS-level or on-disk state.
 *
 * `distribution-identity.json` mirrors this data for CommonJS packaging
 * consumers (`config/electron-builder-downstream.cjs`,
 * `config/scripts/build-computer-macos.mjs`); the equality test in
 * `distribution-identity.test.ts` keeps the two in sync.
 *
 * The active distribution is selected at compile time: electron-vite
 * substitutes `ORCA_DISTRIBUTION` ('horca' when ORCA_DOWNSTREAM_BUILD=1 is
 * set at build time, 'official' otherwise). Vitest and tsc-compiled entry
 * points skip the define pass, so those fall back to a
 * `globalThis.ORCA_DISTRIBUTION` override, then the committed downstream
 * build profile. Official builds come from upstream/main.
 */

import { DOWNSTREAM_DISTRIBUTION } from './horca/distribution-build-profile'

export type OrcaDistribution = 'official' | 'horca'

declare const ORCA_DISTRIBUTION: OrcaDistribution

export type DistributionIdentity = {
  distribution: OrcaDistribution
  productName: string
  appId: string
  appUserModelId: string
  protocol: string
  publicCli: string
  stateRootDirName: string
  updaterEnabled: boolean
  /** %LOCALAPPDATA% folder holding the relocated Windows terminal daemon host. */
  windowsDaemonHostRootName: string
  /** Distinct daemon image name so each app's uninstaller can only kill its own. */
  windowsTerminalDaemonImageName: string
  /** Electron executableName / AppImage binary; official uses orca-ide to avoid GNOME Orca. */
  linuxExecutableName: string
  /** WM_CLASS / desktop StartupWMClass. */
  linuxStartupWmClass: string
  /** deb/rpm packageName. */
  linuxPackageName: string
}

export const DISTRIBUTION_IDENTITIES: Record<OrcaDistribution, DistributionIdentity> = {
  official: {
    distribution: 'official',
    productName: 'Orca',
    appId: 'com.stablyai.orca',
    appUserModelId: 'com.stablyai.orca',
    protocol: 'orca',
    publicCli: 'orca',
    stateRootDirName: '.orca',
    updaterEnabled: true,
    windowsDaemonHostRootName: 'Orca',
    windowsTerminalDaemonImageName: 'orca-terminal-daemon.exe',
    linuxExecutableName: 'orca-ide',
    linuxStartupWmClass: 'orca',
    linuxPackageName: 'orca-ide'
  },
  horca: {
    distribution: 'horca',
    productName: 'Horca',
    appId: 'com.rudironsoni.horca',
    appUserModelId: 'com.rudironsoni.horca',
    protocol: 'horca',
    publicCli: 'horca',
    stateRootDirName: '.horca',
    updaterEnabled: false,
    windowsDaemonHostRootName: 'Horca',
    windowsTerminalDaemonImageName: 'horca-terminal-daemon.exe',
    linuxExecutableName: 'horca-ide',
    linuxStartupWmClass: 'horca',
    linuxPackageName: 'horca-ide'
  }
}

export function getActiveDistribution(): OrcaDistribution {
  // Why typeof-guarded: tsc-compiled entry points (packaged CLI) skip the
  // define pass, leaving the identifier undeclared at runtime.
  // oxlint-disable-next-line unicorn/no-typeof-undefined -- Safe undeclared build-define probe.
  if (typeof ORCA_DISTRIBUTION !== 'undefined') {
    return ORCA_DISTRIBUTION
  }
  const testOverride = (globalThis as { ORCA_DISTRIBUTION?: OrcaDistribution }).ORCA_DISTRIBUTION
  return testOverride ?? DOWNSTREAM_DISTRIBUTION
}

export function getDistributionIdentity(): DistributionIdentity {
  return DISTRIBUTION_IDENTITIES[getActiveDistribution()]
}

/**
 * URL protocols this build accepts when parsing its own deep links.
 *
 * The `orca:` link FORMAT is a cross-client wire surface (mobile app, web
 * client, and remote hosts generate and paste such links), so every
 * distribution keeps accepting it. Only the OS-level protocol REGISTRATION —
 * which app opens when a link is clicked — is per-distribution.
 */
export function getAcceptedDeepLinkProtocols(): ReadonlySet<string> {
  return new Set(['orca:', `${getDistributionIdentity().protocol}:`])
}
