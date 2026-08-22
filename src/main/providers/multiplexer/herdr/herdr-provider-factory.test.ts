import { existsSync, readFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
const electronMocks = vi.hoisted(() => ({
  getAllWindows: vi.fn(() => []),
  getFocusedWindow: vi.fn(() => null)
}))
vi.mock('electron', () => ({ BrowserWindow: electronMocks }))

import { getDefaultSettings } from '../../../../shared/constants'
import type { Store } from '../../../persistence'
import type { HerdrHostTransport } from './herdr-runtime-contract'
import { HerdrCliHostTransport } from './herdr-cli-session'
import { HerdrSocketTransport } from './herdr-socket-transport'
import { HerdrSshHostTransport } from './herdr-ssh-session'
import {
  createLocalHerdrPtyProvider,
  createSshHerdrPtyProvider,
  presentHerdrImportedSurface,
  presentHerdrSurfaceAction
} from './herdr-provider-factory'
import { clearWslHerdrExecutableCache, resolveWslHerdrExecutable } from './herdr-wsl-executable'

vi.mock('./herdr-wsl-executable', () => ({
  resolveWslHerdrExecutable: vi.fn(async () => '/usr/local/bin/herdr'),
  clearWslHerdrExecutableCache: vi.fn()
}))
import type { SshConnection } from '../../../ssh/ssh-connection'

function makeStore(settings: ReturnType<typeof getDefaultSettings>): Store {
  return { getSettings: () => settings } as unknown as Store
}

type TestSettings = ReturnType<typeof getDefaultSettings>

function localTransport(settings: TestSettings): HerdrHostTransport {
  const provider = createLocalHerdrPtyProvider(undefined, makeStore(settings))
  const transportForTarget = (
    provider as unknown as {
      transportForTarget(target: {
        identity: { hostId: string }
        project: { id: string }
      }): HerdrHostTransport
    }
  ).transportForTarget
  return transportForTarget({ identity: { hostId: 'local' }, project: { id: 'project-1' } })
}

describe('createLocalHerdrPtyProvider stock routing', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    electronMocks.getAllWindows.mockReturnValue([])
    electronMocks.getFocusedWindow.mockReturnValue(null)
    delete process.env.HERDR_TEST_LEAK
    clearWslHerdrExecutableCache()
  })

  it('execs the login-PATH herdr binary for a WSL host', async () => {
    const settings: TestSettings = {
      ...getDefaultSettings('/tmp'),
      terminalBackendDefault: 'herdr'
    }
    const provider = createLocalHerdrPtyProvider(undefined, makeStore(settings))
    const transport = (
      provider as unknown as {
        transportForTarget(target: {
          identity: { hostId: string }
          project: { id: string }
        }): HerdrHostTransport
      }
    ).transportForTarget({
      identity: { hostId: 'wsl:Ubuntu' },
      project: { id: 'project-1' }
    })
    expect(transport).toBeInstanceOf(HerdrCliHostTransport)
    const command = await (
      transport as unknown as {
        options: {
          wslDistro?: string
          commandFor(args: string[]): Promise<{ file: string; args: string[] }>
        }
      }
    ).options.commandFor(['workspace', 'list'])
    expect((transport as unknown as { options: { wslDistro?: string } }).options.wslDistro).toBe(
      'Ubuntu'
    )
    expect(command.file).toBe('/usr/local/bin/herdr')
    expect(command.args).toEqual(['workspace', 'list'])
    expect(resolveWslHerdrExecutable).toHaveBeenCalled()
  })

  it('routes the herdr backend to the stock socket transport by default', () => {
    const settings: TestSettings = {
      ...getDefaultSettings('/tmp'),
      terminalBackendDefault: 'herdr'
    }
    expect(localTransport(settings)).toBeInstanceOf(HerdrSocketTransport)
  })

  it('routes the herdr backend to the stock socket transport when the runtime is stock', () => {
    const settings: TestSettings = {
      ...getDefaultSettings('/tmp'),
      terminalBackendDefault: 'herdr',
      herdrSessionName: 'shared-name'
    }
    const transport = localTransport(settings)
    expect(transport).toBeInstanceOf(HerdrSocketTransport)

    const options = (
      transport as unknown as {
        options: {
          sessionName: string
          serverCommandFor(sessionName: string): {
            file: string
            args: string[]
            env: NodeJS.ProcessEnv
          }
        }
      }
    ).options
    expect(options.sessionName).toBe('shared-name')

    process.env.HERDR_TEST_LEAK = 'must-be-stripped'
    const serverCommand = options.serverCommandFor('mysession')
    expect(serverCommand.file).toBe('herdr')
    expect(serverCommand.args).toEqual(['--session', 'mysession', 'server'])
    expect(serverCommand.env.HERDR_TEST_LEAK).toBeUndefined()
    expect(serverCommand.env.HERDR_SESSION).toBeUndefined()
  })

  it('falls back to the stock socket transport for a non-herdr backend', () => {
    const settings: TestSettings = { ...getDefaultSettings('/tmp') }
    expect(localTransport(settings)).toBeInstanceOf(HerdrSocketTransport)
  })

  it('keys cached transports by host, resolved session, and binary source', () => {
    const settings: TestSettings = { ...getDefaultSettings('/tmp'), herdrSessionName: 'one' }
    const provider = createLocalHerdrPtyProvider(undefined, makeStore(settings))
    const transportForTarget = (
      provider as unknown as {
        transportForTarget(target: {
          identity: { hostId: string }
          project: { id: string; herdrSessionName?: string }
        }): HerdrHostTransport
      }
    ).transportForTarget
    const target = { identity: { hostId: 'local' }, project: { id: 'project-1' } }
    const first = transportForTarget(target)
    expect(transportForTarget(target)).toBe(first)
    settings.herdrSessionName = 'two'
    const second = transportForTarget(target)
    expect(second).not.toBe(first)
    const projectTransport = transportForTarget({
      identity: { hostId: 'local' },
      project: { id: 'project-1', herdrSessionName: 'project-session' }
    }) as HerdrSocketTransport
    expect(
      (
        projectTransport as unknown as {
          options: { sessionName: string }
        }
      ).options.sessionName
    ).toBe('project-session')
    settings.herdrBinarySource = { kind: 'custom', path: '/opt/herdr' }
    expect(transportForTarget(target)).not.toBe(second)
  })

  it('disconnects cached transports even when they have no live bindings', () => {
    const settings: TestSettings = { ...getDefaultSettings('/tmp'), herdrSessionName: 'one' }
    const provider = createLocalHerdrPtyProvider(undefined, makeStore(settings))
    const transportForTarget = (
      provider as unknown as {
        transportForTarget(target: {
          identity: { hostId: string }
          project: { id: string }
        }): HerdrHostTransport
      }
    ).transportForTarget
    const transport = transportForTarget({
      identity: { hostId: 'local' },
      project: { id: 'project-1' }
    })
    const disconnect = vi.spyOn(transport, 'disconnect').mockResolvedValue()

    provider.dispose()

    expect(disconnect).toHaveBeenCalledOnce()
  })
})

describe('createSshHerdrPtyProvider', () => {
  it('routes system SSH through herdr --remote on the Orca host', () => {
    const settings: TestSettings = {
      ...getDefaultSettings('/tmp'),
      terminalBackendDefault: 'herdr'
    }
    const connection = {
      getTarget: () => ({
        id: 'box',
        label: 'box',
        host: 'box.example',
        port: 22,
        username: 'ada',
        configHost: 'workbox',
        source: 'ssh-config' as const
      }),
      getSystemSshResolvedConfig: () => ({ hostname: 'box.example', user: 'ada', port: 22 }),
      usesSystemSshTransport: () => true
    } as unknown as SshConnection
    const provider = createSshHerdrPtyProvider(undefined, makeStore(settings), connection, 'box')
    const transport = (
      provider as unknown as {
        transportForTarget(target: {
          identity: { hostId: string }
          project: { id: string }
        }): HerdrHostTransport
      }
    ).transportForTarget({
      identity: { hostId: 'ssh:box' },
      project: { id: 'project-1' }
    })
    expect(transport).toBeInstanceOf(HerdrCliHostTransport)
    const options = (
      transport as unknown as {
        options: {
          commandFor(args: string[]): { file: string; args: string[]; env?: NodeJS.ProcessEnv }
          serverCommandFor(sessionName: string): {
            file: string
            args: string[]
            env?: NodeJS.ProcessEnv
          }
        }
      }
    ).options
    const command = options.commandFor(['workspace', 'list'])
    expect(command.args.slice(0, 2)).toEqual(['--remote', 'workbox'])
    expect(command.env?.HERDR_CONFIG_PATH).toBeTruthy()
    expect(readFileSync(command.env?.HERDR_CONFIG_PATH ?? '', 'utf8')).toContain(
      'manage_ssh_config = false'
    )
    const shimDir = command.env?.PATH?.split(delimiter)[0]
    expect(shimDir).toContain('orca-herdr-remote')
    if (process.platform !== 'win32') {
      const shim = readFileSync(join(shimDir ?? '', 'ssh'), 'utf8')
      expect(shim).toContain('ControlMaster=no')
      expect(shim).toContain('ControlPath=')
    }
    expect(options.serverCommandFor('orca').args).toEqual([
      '--remote',
      'workbox',
      '--handoff',
      '--session',
      'orca',
      'server'
    ])
    provider.dispose()
    expect(existsSync(shimDir ?? '')).toBe(false)
  })

  it('execs over the live connection when the host is ssh2-only', () => {
    const settings: TestSettings = { ...getDefaultSettings('/tmp') }
    const connection = {
      getTarget: () => ({
        id: 'box',
        label: 'box',
        host: 'box.example',
        port: 22,
        username: 'ada',
        source: 'manual' as const
      }),
      getSystemSshResolvedConfig: () => null,
      usesSystemSshTransport: () => false
    } as unknown as SshConnection
    const provider = createSshHerdrPtyProvider(undefined, makeStore(settings), connection, 'box')
    const transport = (
      provider as unknown as {
        transportForTarget(target: {
          identity: { hostId: string }
          project: { id: string }
        }): HerdrHostTransport
      }
    ).transportForTarget({
      identity: { hostId: 'ssh:box' },
      project: { id: 'project-1' }
    })
    expect(transport).toBeInstanceOf(HerdrSshHostTransport)
  })

  it('installs imported-surface presentation callbacks for SSH', () => {
    const settings: TestSettings = { ...getDefaultSettings('/tmp') }
    const connection = {
      getTarget: () => targetConnection,
      usesSystemSshTransport: () => false
    } as unknown as SshConnection
    const provider = createSshHerdrPtyProvider(undefined, makeStore(settings), connection, 'box')
    const sync = (provider as unknown as { surfaceSync: Record<string, unknown> }).surfaceSync
    expect(sync.present).toBe(presentHerdrImportedSurface)
    expect(sync.presentAction).toBe(presentHerdrSurfaceAction)
  })
})

const targetConnection = {
  id: 'box',
  label: 'box',
  host: 'box.example',
  port: 22,
  username: 'ada',
  source: 'manual' as const
}

describe('Herdr imported surface window ownership', () => {
  it('presents a surface once and routes actions to the same window', () => {
    const first = { isDestroyed: () => false, webContents: { send: vi.fn() } }
    const second = { isDestroyed: () => false, webContents: { send: vi.fn() } }
    electronMocks.getFocusedWindow.mockReturnValue(first as never)
    electronMocks.getAllWindows.mockReturnValue([first, second] as never)
    const surface = {
      worktreeId: 'wt-window-owner',
      tabId: 'tab-window-owner',
      leafId: 'leaf-window-owner',
      paneId: 'pane-window-owner',
      ptyId: 'pty-window-owner'
    }

    presentHerdrImportedSurface(surface)
    presentHerdrImportedSurface(surface)
    presentHerdrSurfaceAction({ kind: 'rename', tabId: surface.tabId, title: 'Renamed' })

    expect(first.webContents.send).toHaveBeenCalledTimes(2)
    expect(second.webContents.send).not.toHaveBeenCalled()
  })
})
