import { herdrSessionNameForProject } from '../../../../shared/horca/herdr-session-identity'
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
import {
  LOCAL_EXECUTION_HOST_ID,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import {
  normalizeHerdrBinarySource,
  type HerdrBinarySource
} from '../../../../shared/horca/terminal-backend'
import {
  createHorcaTerminalSettingsSource,
  type HorcaTerminalSettingsSource
} from '../../../horca/terminal-backend/horca-terminal-settings'
import { HerdrSshHostTransport } from './herdr-ssh-session'
import { HerdrSocketTransport } from './herdr-socket-transport'
import type { HerdrHostTransport } from './herdr-runtime-contract'
import { HerdrRuntimeError } from './herdr-runtime-contract'
import { createHerdrSurfaceSync } from './herdr-surface-presentation'
import { herdrRemoteCommandEnv, writeHerdrRemoteSshLaunch } from './herdr-remote-ssh'
import { resolveWslHerdrExecutable } from './herdr-wsl-executable'

export function createLocalHerdrPtyProvider(
  fallback: IPtyProvider | undefined,
  store: Store,
  terminalSettings: HorcaTerminalSettingsSource = createHorcaTerminalSettingsSource(store)
): HerdrPtyProvider {
  const transports = new Map<string, HerdrHostTransport>()
  return new HerdrPtyProvider(
    (target) => {
      const hostId = target.identity.hostId
      const settings = terminalSettings.getHerdrSettings(hostId as ExecutionHostId)
      const projectSettings = terminalSettings.getProjectSettings(target.project.id)
      const source = resolveHerdrBinarySource(settings, hostId as ExecutionHostId)
      const sessionName = herdrSessionNameForProject(
        {
          id: target.project.id,
          herdrSessionName:
            (target.project as { herdrSessionName?: string }).herdrSessionName ??
            projectSettings.sessionName
        },
        settings.defaultSessionName
      )
      const key = herdrTransportKey(target, sessionName, source)
      let transport = transports.get(key)
      if (transport) {
        return transport
      }
      const wslDistro = parseWslHostId(hostId)
      if (wslDistro) {
        const executableFor = () => resolveWslHerdrExecutable(wslDistro, source)
        transport = new HerdrCliHostTransport({
          wslDistro,
          commandFor: async (args) => ({
            file: await executableFor(),
            args
          }),
          serverCommandFor: async (sessionName) => {
            const executable = await executableFor()
            const envKeysToRemove = Object.keys(process.env).filter((k) => k.startsWith('HERDR_'))
            return {
              file: '/usr/bin/env',
              args: [
                ...envKeysToRemove.flatMap((k) => ['-u', k]),
                executable,
                '--session',
                sessionName,
                'server'
              ]
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
    createLocalHerdrPtyTargetResolver(store, terminalSettings),
    () => terminalSettings.getHerdrSettings(LOCAL_EXECUTION_HOST_ID).defaultSessionName,
    createHerdrSurfaceSync(store),
    fallback,
    () => disconnectHerdrTransports(transports)
  )
}

export function createSshHerdrPtyProvider(
  fallback: IPtyProvider | undefined,
  store: Store,
  connection: SshConnection,
  targetId: string,
  hostPlatform?: RemoteHostPlatform,
  terminalSettings: HorcaTerminalSettingsSource = createHorcaTerminalSettingsSource(store)
): HerdrPtyProvider {
  const hostId = toSshExecutionHostId(targetId)
  const transports = new Map<string, HerdrHostTransport>()

  return new HerdrPtyProvider(
    (target) => {
      const settings = terminalSettings.getHerdrSettings(hostId)
      const source = resolveHerdrBinarySource(settings, hostId)
      const projectSettings = terminalSettings.getProjectSettings(target.project.id)
      const sessionName = herdrSessionNameForProject(
        {
          id: target.project.id,
          herdrSessionName:
            (target.project as { herdrSessionName?: string }).herdrSessionName ??
            projectSettings.sessionName
        },
        settings.defaultSessionName
      )
      const key = herdrTransportKey(target, sessionName, source)
      let transport = transports.get(key)
      if (!transport) {
        transport = createSshHerdrHostTransport(connection, source, hostPlatform)
        transports.set(key, transport)
      }
      return transport
    },
    createHerdrPtyTargetResolver(store, hostId, terminalSettings),
    () => terminalSettings.getHerdrSettings(hostId).defaultSessionName,
    createHerdrSurfaceSync(store),
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

type HerdrSettings = {
  binarySource?: unknown
  herdrBinarySource?: unknown
  hostSettingOverrides?: Partial<Record<ExecutionHostId, { herdrBinarySource?: unknown }>>
}

function herdrTransportKey(
  target: HerdrPtyTarget,
  sessionName: string,
  source: HerdrBinarySource
): string {
  const sourceKey = source.kind === 'custom' ? `custom:${source.path.trim()}` : source.kind
  return `${target.identity.hostId}\n${sessionName}\n${sourceKey}`
}

export function resolveHerdrBinarySource(
  settings: HerdrSettings,
  hostId: ExecutionHostId
): HerdrBinarySource {
  return normalizeHerdrBinarySource(
    settings.hostSettingOverrides?.[hostId]?.herdrBinarySource ??
      settings.herdrBinarySource ??
      settings.binarySource
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

export {
  presentHerdrImportedSurface,
  presentHerdrSurfaceAction,
  resetHerdrImportedSurfaceOwnersForTests
} from './herdr-surface-presentation'
