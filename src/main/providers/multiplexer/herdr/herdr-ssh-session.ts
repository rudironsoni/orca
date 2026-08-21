import { StringDecoder } from 'node:string_decoder'
import type { ClientChannel } from 'ssh2'
import type { SshConnection } from '../../../ssh/ssh-connection'
import { shellEscape } from '../../../ssh/ssh-connection-utils'
import { powerShellCommand, powerShellLiteral } from '../../../ssh/ssh-remote-powershell'
import type { RemoteHostPlatform } from '../../../ssh/ssh-remote-platform'
import type {
  HerdrApiSchema,
  HerdrHostTransport,
  HerdrResponse,
  HerdrTerminalController,
  HerdrTerminalControlOptions
} from './herdr-runtime-contract'
import {
  assertHerdrSchemaCompatible,
  assertHerdrServerCompatible,
  HerdrRuntimeError,
  unwrapHerdrResponse
} from './herdr-runtime-contract'
import {
  herdrStockCliInvocation,
  parseHerdrSessionList,
  type HerdrListedSession
} from './herdr-cli-session'
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
  private schema: HerdrApiSchema | null = null

  constructor(
    private readonly connection: SshConnection,
    private readonly timeoutMs = 15_000,
    private readonly resolveExecutable: () => Promise<string> = async () => 'herdr',
    private readonly hostPlatform?: RemoteHostPlatform
  ) {}

  async ensureSession(sessionName: string): Promise<void> {
    const existing = this.sessionPromises.get(sessionName)
    if (existing) {
      return await existing
    }
    const pending = this.ensureSessionInner(sessionName)
    this.sessionPromises.set(sessionName, pending)
    try {
      await pending
    } finally {
      if (this.sessionPromises.get(sessionName) === pending) {
        this.sessionPromises.delete(sessionName)
      }
    }
  }

  private async ensureSessionInner(sessionName: string): Promise<void> {
    const schema = await this.loadSchema()
    const sessions = await this.listSessions()
    if (!sessions.some((session) => session.name === sessionName && session.running)) {
      await this.startServer(sessionName)
      await this.waitForSession(sessionName)
    }
    const invocation = herdrStockCliInvocation(sessionName, 'session.snapshot', {})
    const response = invocation.parse(await this.run(invocation.args)) as HerdrResponse<{
      snapshot: { protocol: number }
    }>
    assertHerdrServerCompatible(schema, unwrapHerdrResponse(response).snapshot.protocol)
  }

  private async loadSchema(): Promise<HerdrApiSchema> {
    if (!this.schema) {
      const schema = JSON.parse(await this.run(['api', 'schema', '--json'])) as HerdrApiSchema
      assertHerdrSchemaCompatible(schema)
      this.schema = schema
    }
    return this.schema
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

  private async waitForSession(sessionName: string): Promise<void> {
    const deadline = Date.now() + this.timeoutMs
    while (Date.now() < deadline) {
      const sessions = await this.listSessions().catch(() => [])
      if (sessions.some((session) => session.name === sessionName && session.running)) {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new HerdrRuntimeError(
      'herdr_unavailable',
      `Remote Herdr session ${sessionName} did not start within ${this.timeoutMs}ms`
    )
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
  private readonly sessionManager: HerdrSshSessionManager

  constructor(
    connection: SshConnection,
    timeoutMs = 15_000,
    resolveExecutable: () => Promise<string> = async () => 'herdr',
    hostPlatform?: RemoteHostPlatform,
    sessionManager?: HerdrSshSessionManager
  ) {
    this.sessionManager =
      sessionManager ??
      new HerdrSshSessionManager(connection, timeoutMs, resolveExecutable, hostPlatform)
  }

  async ensureSession(sessionName: string): Promise<void> {
    await this.sessionManager.ensureSession(sessionName)
  }

  async request<T>(
    sessionName: string,
    method: string,
    params: unknown
  ): Promise<HerdrResponse<T>> {
    const invocation = herdrStockCliInvocation(sessionName, method, params)
    return invocation.parse(await this.sessionManager.run(invocation.args)) as HerdrResponse<T>
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
}
