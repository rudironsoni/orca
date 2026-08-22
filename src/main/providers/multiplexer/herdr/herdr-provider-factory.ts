import { BrowserWindow } from 'electron'
import { herdrSessionNameForProject } from '../../../../shared/herdr-session-identity'
import type { Store } from '../../../persistence'
import type { IPtyProvider } from '../../types'
import {
  HerdrCliHostTransport,
  herdrServerEnvironment,
  localHerdrCommand
} from './herdr-cli-session'
import { HerdrPtyProvider } from './herdr-pty-provider'
import type { HerdrPtyTarget } from './herdr-pty-types'
import {
  createHerdrPtyTargetResolver,
  createLocalHerdrPtyTargetResolver
} from './herdr-project-pty-target'
import type { SshConnection } from '../../../ssh/ssh-connection'
import type { RemoteHostPlatform } from '../../../ssh/ssh-remote-platform'
import { toSshExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  normalizeHerdrBinarySource,
  type HerdrBinarySource
} from '../../../../shared/terminal-backend'
import { HerdrSshHostTransport } from './herdr-ssh-session'
import { HerdrSocketTransport } from './herdr-socket-transport'
import type { HerdrHostTransport } from './herdr-runtime-contract'
import { HerdrRuntimeError } from './herdr-runtime-contract'
import type { HerdrImportedSurface, HerdrOrcaSurfaceAction } from './herdr-orca-surface-import'
import { herdrRemoteCommandEnv, writeHerdrRemoteSshLaunch } from './herdr-remote-ssh'
import { resolveWslHerdrExecutable } from './herdr-wsl-executable'
import { buildWslExecArgs } from '../../../../shared/wsl-login-shell-command'

export function createLocalHerdrPtyProvider(
  fallback: IPtyProvider | undefined,
  store: Store
): HerdrPtyProvider {
  const transports = new Map<string, HerdrHostTransport>()
  return new HerdrPtyProvider(
    (target) => {
      const hostId = target.identity.hostId
      const settings = store.getSettings()
      const source = resolveHerdrBinarySource(settings, hostId as ExecutionHostId)
      const sessionName = herdrSessionNameForProject(target.project, settings.herdrSessionName)
      const key = herdrTransportKey(target, settings.herdrSessionName, source)
      let transport = transports.get(key)
      if (transport) {
        return transport
      }
      const wslDistro = parseWslHostId(hostId)
      if (wslDistro) {
        const executable = resolveWslHerdrExecutable(wslDistro, source)
        transport = new HerdrCliHostTransport({
          commandFor: (args) => ({
            file: 'wsl.exe',
            args: buildWslExecArgs(wslDistro, [executable, ...args])
          }),
          serverCommandFor: (sessionName) => {
            const envKeysToRemove = Object.keys(process.env).filter((k) => k.startsWith('HERDR_'))
            return {
              file: 'wsl.exe',
              args: buildWslExecArgs(wslDistro, [
                'env',
                ...envKeysToRemove.flatMap((k) => ['-u', k]),
                executable,
                '--session',
                sessionName,
                'server'
              ])
            }
          }
        })
      } else {
        const executable = resolveHerdrExecutable(source)
        transport = new HerdrSocketTransport({
          sessionName,
          commandFor: localHerdrCommand(executable),
          serverCommandFor: (sessionName) => ({
            file: executable,
            args: ['--session', sessionName, 'server'],
            // Why: strip HERDR_* so a server spawned from inside a stock herdr
            // session binds the named session, not the parent session's socket.
            env: herdrServerEnvironment(undefined)
          })
        })
      }
      transports.set(key, transport)
      return transport
    },
    createLocalHerdrPtyTargetResolver(store),
    () => store.getSettings().herdrSessionName,
    herdrSurfaceSync(store),
    fallback,
    () => disconnectHerdrTransports(transports)
  )
}

export function createSshHerdrPtyProvider(
  fallback: IPtyProvider | undefined,
  store: Store,
  connection: SshConnection,
  targetId: string,
  hostPlatform?: RemoteHostPlatform
): HerdrPtyProvider {
  const hostId = toSshExecutionHostId(targetId)
  const transports = new Map<string, HerdrHostTransport>()

  return new HerdrPtyProvider(
    (target) => {
      const settings = store.getSettings()
      const source = resolveHerdrBinarySource(settings, hostId)
      const key = herdrTransportKey(target, settings.herdrSessionName, source)
      let transport = transports.get(key)
      if (!transport) {
        transport = createSshHerdrHostTransport(connection, source, hostPlatform)
        transports.set(key, transport)
      }
      return transport
    },
    createHerdrPtyTargetResolver(store, hostId),
    () => store.getSettings().herdrSessionName,
    herdrSurfaceSync(store),
    fallback,
    () => disconnectHerdrTransports(transports)
  )
}

function disconnectHerdrTransports(transports: Map<string, HerdrHostTransport>): void {
  for (const transport of new Set(transports.values())) {
    void Promise.resolve(transport.disconnect?.()).catch(() => undefined)
  }
  transports.clear()
}

function createSshHerdrHostTransport(
  connection: SshConnection,
  source: HerdrBinarySource,
  hostPlatform?: RemoteHostPlatform
): HerdrHostTransport {
  const target = connection.getTarget()
  const resolvedConfig = connection.getSystemSshResolvedConfig?.() ?? null
  const systemSsh = connection.usesSystemSshTransport?.() === true
  // Why: ssh2-only connections have no OpenSSH ControlMaster. Exec over the
  // live SshConnection keeps passphrase and host-key state that a new hop
  // would not see.
  if (!systemSsh) {
    const remoteExecutable = async () => resolveHerdrExecutable(source, hostPlatform?.os ?? 'linux')
    return new HerdrSshHostTransport(connection, 15_000, remoteExecutable, hostPlatform)
  }

  const launch = writeHerdrRemoteSshLaunch({ target, resolvedConfig })
  const executable = resolveHerdrExecutable(source)
  return new HerdrCliHostTransport({
    commandFor: (args) => ({
      file: executable,
      args: ['--remote', launch.dest, ...args],
      env: herdrRemoteCommandEnv(launch)
    }),
    serverCommandFor: (sessionName) => ({
      file: executable,
      args: ['--remote', launch.dest, '--handoff', '--session', sessionName, 'server'],
      env: herdrRemoteCommandEnv(launch, herdrServerEnvironment(undefined))
    }),
    onDisconnect: launch.cleanup
  })
}

type HerdrSettings = Pick<GlobalSettings, 'herdrBinarySource' | 'hostSettingOverrides'>

function herdrTransportKey(
  target: HerdrPtyTarget,
  sharedName: string | undefined,
  source: HerdrBinarySource
): string {
  const sessionName = herdrSessionNameForProject(target.project, sharedName)
  const sourceKey = source.kind === 'custom' ? `custom:${source.path.trim()}` : source.kind
  return `${target.identity.hostId}\n${sessionName}\n${sourceKey}`
}

export function resolveHerdrBinarySource(
  settings: HerdrSettings,
  hostId: ExecutionHostId
): HerdrBinarySource {
  return normalizeHerdrBinarySource(
    settings.hostSettingOverrides?.[hostId]?.herdrBinarySource ?? settings.herdrBinarySource
  )
}

export function resolveHerdrExecutable(
  source: HerdrBinarySource,
  platform: NodeJS.Platform = process.platform
): string {
  if (source.kind === 'custom') {
    const customPath = source.path.trim()
    if (!customPath) {
      throw new HerdrRuntimeError('herdr_unavailable', 'Custom Herdr path is empty')
    }
    return customPath
  }
  return platform === 'win32' ? 'herdr.exe' : 'herdr'
}

function parseWslHostId(hostId: string): string | null {
  if (!hostId.startsWith('wsl:')) {
    return null
  }
  try {
    const distro = decodeURIComponent(hostId.slice('wsl:'.length))
    return distro || null
  } catch {
    return null
  }
}

function herdrSurfaceSync(store: Store) {
  return {
    persist: (surface: HerdrImportedSurface) => {
      store.persistPtyBinding({
        worktreeId: surface.worktreeId,
        tabId: surface.tabId,
        leafId: surface.leafId,
        ptyId: surface.ptyId,
        ...(surface.cwd ? { startupCwd: surface.cwd } : {})
      })
    },
    present: presentHerdrImportedSurface,
    presentAction: presentHerdrSurfaceAction
  }
}

const importedSurfaceOwners = new Map<string, { owner: BrowserWindow; tabId: string }>()
const importedTabOwners = new Map<string, BrowserWindow>()

function liveOwner(owner: BrowserWindow | undefined): BrowserWindow | null {
  return owner && !owner.isDestroyed() ? owner : null
}

function ownerForTab(tabId: string): BrowserWindow | null {
  const existing = liveOwner(importedTabOwners.get(tabId))
  if (existing) {
    return existing
  }
  const owner =
    liveOwner(BrowserWindow.getFocusedWindow() ?? undefined) ??
    BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed()) ??
    null
  if (owner) {
    importedTabOwners.set(tabId, owner)
  }
  return owner
}

export function presentHerdrImportedSurface(surface: HerdrImportedSurface): void {
  const existing = importedSurfaceOwners.get(surface.ptyId)
  if (liveOwner(existing?.owner)) {
    return
  }
  const owner = ownerForTab(surface.tabId)
  if (!owner) {
    return
  }
  importedSurfaceOwners.set(surface.ptyId, { owner, tabId: surface.tabId })
  owner.webContents.send('ui:createTerminal', {
    worktreeId: surface.worktreeId,
    ptyId: surface.ptyId,
    tabId: surface.tabId,
    leafId: surface.leafId,
    title: surface.title,
    ...(surface.cwd ? { cwd: surface.cwd } : {}),
    activate: false,
    focus: false,
    presentation: 'background',
    ...(surface.splitFromLeafId
      ? {
          splitFromLeafId: surface.splitFromLeafId,
          splitDirection: surface.splitDirection ?? 'vertical'
        }
      : {})
  })
}

export function presentHerdrSurfaceAction(action: HerdrOrcaSurfaceAction): void {
  const contents = ownerForTab(action.tabId)?.webContents
  if (!contents) {
    return
  }
  if (action.kind === 'rename') {
    contents.send('ui:renameTerminal', { tabId: action.tabId, title: action.title })
    return
  }
  if (action.kind === 'focus') {
    contents.send('ui:focusTerminal', {
      tabId: action.tabId,
      worktreeId: action.worktreeId,
      leafId: action.leafId
    })
    return
  }
  if (action.kind === 'close') {
    contents.send('ui:closeTerminal', { tabId: action.tabId })
    importedTabOwners.delete(action.tabId)
    for (const [ptyId, entry] of importedSurfaceOwners) {
      if (entry.tabId === action.tabId) {
        importedSurfaceOwners.delete(ptyId)
      }
    }
    return
  }
  contents.send('ui:applyTerminalLayout', { tabId: action.tabId, layout: action.layout })
}
