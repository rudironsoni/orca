import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  autoUpdaterMock,
  powerMonitorOnMock,
  fetchNudgeMock,
  fetchNewerReleaseTagsMock,
  moduleFactories,
  resetUpdaterMocks
} = await vi.hoisted(async () => (await import('./updater-test-harness')).createUpdaterMocks())

vi.mock('electron', () => moduleFactories.electron())
vi.mock('electron-updater', () => moduleFactories.electronUpdater())
vi.mock('./electron-updater-loader', () => moduleFactories.electronUpdaterLoader())
vi.mock('@electron-toolkit/utils', () => moduleFactories.electronToolkitUtils())
vi.mock('./ipc/pty', () => moduleFactories.ipcPty())
vi.mock('./linux-update-package-type', () => moduleFactories.linuxUpdatePackageType())
vi.mock('./updater-lifecycle-diagnostics', () => moduleFactories.updaterLifecycleDiagnostics())
vi.mock('./updater-changelog', () => moduleFactories.updaterChangelog())
vi.mock('./updater-nudge', () => moduleFactories.updaterNudge())
vi.mock('./update-install-exit-watchdog', () => moduleFactories.updateInstallExitWatchdog())
vi.mock('./updater-prerelease-feed', () => moduleFactories.updaterPrereleaseFeed())
vi.mock('./local-builds/local-build-switch', () => moduleFactories.localBuildSwitch())
vi.mock('./local-builds/local-build-feed-server', () => moduleFactories.localBuildFeedServer())

const DISABLED_STATUS = {
  state: 'not-available',
  updatesDisabledReason: 'downstream-distribution'
}

describe('updater distribution gate', () => {
  beforeEach(() => {
    resetUpdaterMocks()
  })

  it('official builds keep the in-app updater enabled', async () => {
    const { isInAppUpdaterEnabled } = await import('./updater-distribution-gate')
    expect(isInAppUpdaterEnabled()).toBe(true)
  })

  it('downstream builds disable the in-app updater capability', async () => {
    vi.stubGlobal('ORCA_DISTRIBUTION', 'horca')
    const { isInAppUpdaterEnabled } = await import('./updater-distribution-gate')
    expect(isInAppUpdaterEnabled()).toBe(false)
  })

  it('downstream setup never touches feeds, handlers, nudge polling, or scheduled checks', async () => {
    vi.stubGlobal('ORCA_DISTRIBUTION', 'horca')
    const send = vi.fn()

    const { setupAutoUpdater, getUpdateStatus } = await import('./updater')
    setupAutoUpdater({ webContents: { send } } as never)

    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled()
    expect(autoUpdaterMock.on).not.toHaveBeenCalled()
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(fetchNudgeMock).not.toHaveBeenCalled()
    expect(fetchNewerReleaseTagsMock).not.toHaveBeenCalled()
    expect(powerMonitorOnMock).not.toHaveBeenCalled()
    expect(getUpdateStatus()).toEqual(DISABLED_STATUS)
  })

  it('downstream manual check reports the explanatory status without contacting any feed', async () => {
    vi.stubGlobal('ORCA_DISTRIBUTION', 'horca')
    const send = vi.fn()

    const { setupAutoUpdater, checkForUpdatesFromMenu } = await import('./updater')
    setupAutoUpdater({ webContents: { send } } as never)
    send.mockClear()

    checkForUpdatesFromMenu()
    // Repeat clicks must re-deliver the auto-dismissed status.
    checkForUpdatesFromMenu()

    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(fetchNewerReleaseTagsMock).not.toHaveBeenCalled()
    const statusSends = send.mock.calls.filter(([channel]) => channel === 'updater:status')
    expect(statusSends).toHaveLength(2)
    for (const [, status] of statusSends) {
      expect(status).toEqual({ ...DISABLED_STATUS, userInitiated: true })
    }
  })

  it('downstream remote server update support degrades to updater-unavailable', async () => {
    vi.stubGlobal('ORCA_DISTRIBUTION', 'horca')
    const send = vi.fn()

    const { setupAutoUpdater, getRemoteServerUpdateSupport } = await import('./updater')
    setupAutoUpdater({ webContents: { send } } as never)

    expect(getRemoteServerUpdateSupport()).toEqual({
      installMode: 'interactive',
      automatic: false,
      reason: 'updater-unavailable'
    })
  })

  it('downstream release picker refuses to list official builds', async () => {
    vi.stubGlobal('ORCA_DISTRIBUTION', 'horca')

    const { listAvailableReleaseBuilds } = await import('./updater')

    await expect(listAvailableReleaseBuilds('stable')).rejects.toThrow(
      /In-app updates are disabled/
    )
    expect(fetchNewerReleaseTagsMock).not.toHaveBeenCalled()
  })
})
