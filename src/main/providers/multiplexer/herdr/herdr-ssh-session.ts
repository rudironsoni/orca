import { StringDecoder } from 'node:string_decoder'
import type { ClientChannel } from 'ssh2'
import type { SshConnection } from '../../../ssh/ssh-connection'
import { shellEscape } from '../../../ssh/ssh-connection-utils'
import { powerShellCommand, powerShellLiteral } from '../../../ssh/ssh-remote-powershell'
import type { RemoteHostPlatform } from '../../../ssh/ssh-remote-platform'
import type {
  HerdrHostTransport,
  HerdrTerminalController,
  HerdrTerminalControlOptions
} from './herdr-runtime-contract'
import { parseHerdrSessionList } from './herdr-cli-session'
import { HerdrSdkRuntime } from './herdr-sdk-runtime'
import { HerdrSshSocketRelay } from './herdr-ssh-socket-relay'
import { herdrSessionSocketPath } from './herdr-session-socket-path'
import { getAppEnvironment } from '../../../../shared/app-environment'
import { execCommand } from '../../../ssh/ssh-relay-exec-command'
import { ensureStockHerdrSession, type HerdrListedSession } from './herdr-stock-session'
import {
  createHerdrSessionControlFromOpen,
  herdrSessionControlArgs,
  herdrSessionControlStreamFromChannel
} from './herdr-session-control'
export type HerdrSshSessionOptions = {
  connection: SshConnection
  timeoutMs?: number
  resolveExecutable: () => Promise<string>
  hostPlatform?: RemoteHostPlatform
}

export class HerdrSshSessionManager {
  private executablePromise: Promise<string> | null = null
  private readonly sessionPromises = new Map<string, Promise<void>>()

  constructor(
    private readonly connection: SshConnection,
    private readonly timeoutMs = 15_000,
    private readonly resolveExecutable: () => Promise<string> = async () => 'herdr',
    private readonly hostPlatform?: RemoteHostPlatform
  ) {}

  async ensureSession(sessionName: string): Promise<void> {
    await ensureStockHerdrSession(this.sessionPromises, sessionName, {
      listSessions: () => this.listSessions(),
      startServer: (name) => this.startServer(name),
      timeoutMs: this.timeoutMs
    })
  }

  private async listSessions(): Promise<HerdrListedSession[]> {
    return parseHerdrSessionList(await this.run(['session', 'list', '--json']))
  }

  private async startServer(sessionName: string): Promise<void> {
    const executable = await this.executable()
    if (this.hostPlatform?.commandDialect === 'powershell') {
      const script = [
        `Start-Process -FilePath ${powerShellLiteral(executable)} -ArgumentList @(${['--session', sessionName, 'server'].map(powerShellLiteral).join(', ')}) -WindowStyle Hidden`
      ].join('; ')
      const channel = await this.connection.exec(powerShellCommand(script), {
        wrapCommand: false
      })
      channel.end()
      return
    }
    const command = [
      'nohup',
      shellEscape(executable),
      '--session',
      shellEscape(sessionName),
      'server',
      '</dev/null',
      '>/dev/null',
      '2>&1',
      '&'
    ].join(' ')
    const channel = await this.connection.exec(command)
    channel.end()
  }

  private async executable(): Promise<string> {
    this.executablePromise ??= this.resolveExecutable().catch((error: unknown) => {
      this.executablePromise = null
      throw error
    })
    return await this.executablePromise
  }

  private async command(args: string[]): Promise<string> {
    const executable = await this.executable()
    if (this.hostPlatform?.commandDialect === 'powershell') {
      return powerShellCommand(`& ${[executable, ...args].map(powerShellLiteral).join(' ')}`)
    }
    return [executable, ...args].map(shellEscape).join(' ')
  }

  async open(args: string[]): Promise<ClientChannel> {
    return await this.connection.exec(await this.command(args), {
      wrapCommand: this.hostPlatform?.commandDialect !== 'powershell'
    })
  }

  async run(args: string[]): Promise<string> {
    const channel = await this.open(args)
    return await new Promise((resolve, reject) => {
      const stdoutDecoder = new StringDecoder('utf8')
      const stderrDecoder = new StringDecoder('utf8')
      let stdout = ''
      let stderr = ''
      let exit:
        | { kind: 'code'; code: number }
        | { kind: 'signal'; signal: string; description: string }
        | null = null
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeout)
        stdout += stdoutDecoder.end()
        stderr += stderrDecoder.end()
        if (error) {
          reject(error)
        } else if (exit?.kind === 'code' && exit.code === 0) {
          resolve(stdout)
        } else if (exit?.kind === 'code') {
          reject(new Error(stderr.trim() || `Remote Herdr exited with code ${exit.code}`))
        } else if (exit?.kind === 'signal') {
          const detail = exit.description.trim()
          reject(
            new Error(
              stderr.trim() ||
                `Remote Herdr exited with signal ${exit.signal}${detail ? `: ${detail}` : ''}`
            )
          )
        } else {
          reject(new Error(stderr.trim() || 'Remote Herdr closed without reporting exit status'))
        }
      }
      const timeout = setTimeout(() => {
        finish(new Error(`Remote Herdr command timed out after ${this.timeoutMs}ms`))
        channel.close()
      }, this.timeoutMs)
      channel.on('data', (chunk: Buffer) => (stdout += stdoutDecoder.write(chunk)))
      channel.stderr.on('data', (chunk: Buffer) => (stderr += stderrDecoder.write(chunk)))
      channel.stderr.once('error', finish)
      channel.once('error', finish)
      channel.once(
        'exit',
        (code: number | null, signal?: string, _dump?: string, description?: string) => {
          if (typeof code === 'number') {
            exit = { kind: 'code', code }
          } else if (signal) {
            exit = {
              kind: 'signal',
              signal,
              description: description ?? ''
            }
          }
        }
      )
      channel.once('close', () => {
        finish()
      })
      channel.end()
    })
  }
}

export class HerdrSshHostTransport implements HerdrHostTransport {
  readonly sdk: HerdrSdkRuntime
  private readonly sessionManager: HerdrSshSessionManager
  private readonly relays = new Map<string, HerdrSshSocketRelay>()
  private readonly connection: SshConnection
  private remoteConfigHomePromise: Promise<string> | null = null

  constructor(
    connection: SshConnection,
    timeoutMs = 15_000,
    resolveExecutable: () => Promise<string> = async () => 'herdr',
    hostPlatform?: RemoteHostPlatform,
    sessionManager?: HerdrSshSessionManager
  ) {
    this.connection = connection
    this.sessionManager =
      sessionManager ??
      new HerdrSshSessionManager(connection, timeoutMs, resolveExecutable, hostPlatform)
    this.sdk = new HerdrSdkRuntime({
      application: { name: 'horca', version: getAppEnvironment().getVersion() },
      resolveTarget: (sessionName) => {
        const relay = this.relays.get(sessionName)
        if (!relay) {
          throw new Error(`Herdr SSH relay is not listening for session ${sessionName}`)
        }
        return { sessionName, socketPath: relay.localSocketPath }
      }
    })
  }

  async ensureSession(sessionName: string): Promise<void> {
    await this.sessionManager.ensureSession(sessionName)
    let relay = this.relays.get(sessionName)
    if (!relay) {
      relay = new HerdrSshSocketRelay(
        this.connection,
        herdrSessionSocketPath(await this.remoteConfigHome(), sessionName)
      )
      this.relays.set(sessionName, relay)
      try {
        await relay.listen()
      } catch (error) {
        this.relays.delete(sessionName)
        await relay.dispose()
        throw error
      }
    }
    await this.sdk.ping(sessionName)
  }

  private async remoteConfigHome(): Promise<string> {
    this.remoteConfigHomePromise ??= readRemoteHerdrConfigHome(this.connection).catch(
      (error: unknown) => {
        this.remoteConfigHomePromise = null
        throw error
      }
    )
    return await this.remoteConfigHomePromise
  }

  controlTerminal(
    sessionName: string,
    target: string,
    options: HerdrTerminalControlOptions
  ): HerdrTerminalController {
    return createHerdrSessionControlFromOpen(async () =>
      herdrSessionControlStreamFromChannel(
        await this.sessionManager.open(herdrSessionControlArgs(sessionName, target, options))
      )
    )
  }

  async disconnect(): Promise<void> {
    await this.sdk.dispose()
    await Promise.all([...this.relays.values()].map((relay) => relay.dispose()))
    this.relays.clear()
  }
}

async function readRemoteHerdrConfigHome(connection: SshConnection): Promise<string> {
  const stdout = (
    await execCommand(connection, 'printf %s "${XDG_CONFIG_HOME:-$HOME/.config}"')
  ).trim()
  if (!stdout.startsWith('/') || /[\n\r]/.test(stdout)) {
    throw new Error(`Remote Herdr config home is not an absolute path: ${stdout}`)
  }
  return stdout
}
