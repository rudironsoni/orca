import { afterEach, describe, expect, it } from 'vitest'
import {
  DISTRIBUTION_IDENTITIES,
  getActiveDistribution,
  getDistributionIdentity,
  type OrcaDistribution
} from './distribution-identity'
import { readFileSync } from 'node:fs'
import { LOCAL_BUILD_COMPATIBILITY_CONTRACT } from './local-build-compatibility-contract'

const globalWithOverride = globalThis as { ORCA_DISTRIBUTION?: OrcaDistribution }

afterEach(() => {
  globalWithOverride.ORCA_DISTRIBUTION = 'official'
})

describe('distribution identity contract', () => {
  // Why these exact values are pinned: the official identity is what every
  // installed Orca's OS-level state (bundle id, TCC grants, Keychain
  // safeStorage, protocol registration, ~/.orca) is keyed on. Any drift here
  // is a breaking change for existing installs.
  it('keeps the official identity unchanged', () => {
    expect(DISTRIBUTION_IDENTITIES.official).toEqual({
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
    })
  })

  // Why side-by-side coexistence requires every field to differ from official:
  // a shared value would make the two installed apps collide on that OS or
  // on-disk identity (see docs/FORK_MAINTENANCE.md).
  it('gives the downstream distribution a fully distinct identity', () => {
    expect(DISTRIBUTION_IDENTITIES.horca).toEqual({
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
    })
    const official = DISTRIBUTION_IDENTITIES.official
    const horca = DISTRIBUTION_IDENTITIES.horca
    for (const key of [
      'productName',
      'appId',
      'appUserModelId',
      'protocol',
      'publicCli',
      'stateRootDirName',
      'windowsDaemonHostRootName',
      'windowsTerminalDaemonImageName',
      'linuxExecutableName',
      'linuxStartupWmClass',
      'linuxPackageName'
    ] as const) {
      expect(horca[key], `horca ${key} must not collide with official`).not.toBe(official[key])
    }
  })

  // Why: the JSON is what electron-builder and the packaging scripts consume;
  // drift from the TypeScript source of truth would ship a mismatched identity.
  // Read (not import) so tsconfig projects without json-module support compile;
  // vitest always runs with the repo root as cwd.
  it('keeps the CommonJS packaging mirror identical to the TypeScript contract', () => {
    const mirror: unknown = JSON.parse(
      readFileSync('src/shared/distribution-identity.json', 'utf8')
    )
    expect(mirror).toEqual(DISTRIBUTION_IDENTITIES)
  })

  it('keeps the local-build compatibility contract on the official app id', () => {
    expect(LOCAL_BUILD_COMPATIBILITY_CONTRACT.appId).toBe(DISTRIBUTION_IDENTITIES.official.appId)
  })

  it('resolves the Horca identity when no compile-time define is present', () => {
    globalWithOverride.ORCA_DISTRIBUTION = 'horca'
    expect(getActiveDistribution()).toBe('horca')
    expect(getDistributionIdentity()).toBe(DISTRIBUTION_IDENTITIES.horca)
  })

  it('honors the test override used where the define pass is skipped', () => {
    globalWithOverride.ORCA_DISTRIBUTION = 'official'
    expect(getActiveDistribution()).toBe('official')
    expect(getDistributionIdentity()).toBe(DISTRIBUTION_IDENTITIES.official)
  })
})
