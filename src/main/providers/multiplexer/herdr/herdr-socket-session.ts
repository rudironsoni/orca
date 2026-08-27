import { existsSync } from 'node:fs'
import {
  defaultHerdrSocketPath,
  type HerdrSocketConnectionOptions
} from './herdr-socket-connection'
import {
  herdrServerEnvironment,
  parseHerdrSessionList,
  startDetachedHerdrCommand,
  type HerdrCommand,
  type HerdrCommandFactory
} from './herdr-cli-session'
import { runProcess } from '../../../../shared/child-process/run-process'
import { assertHerdrSchemaCompatible, type HerdrApiSchema } from './herdr-runtime-contract'
import { ensureStockHerdrSession, type HerdrListedSession } from './herdr-stock-session'

export type HerdrSocketSessionOptions = HerdrSocketConnectionOptions & {
  commandFor?: HerdrCommandFactory
  serverCommandFor?: (sessionName: string) => HerdrCommand | Promise<HerdrCommand>
}

export class HerdrSocketSessionManager {
  private readonly options: HerdrSocketSessionOptions
  private readonly sessionPromises = new Map<string, Promise<void>>()
  private schema: HerdrApiSchema | null = null

  constructor(options: HerdrSocketSessionOptions) {
    this.options = options
  }

  async ensureSession(sessionName: string): Promise<void> {
    if (!this.options.commandFor) {
      return
    }
    await ensureStockHerdrSession(this.sessionPromises, sessionName, {
      loadSchema: () => this.loadSchema(),
      listSessions: () => this.listSessions(),
      startServer: (name) => this.startServer(name),
      timeoutMs: this.options.timeoutMs,
      pollMs: 200,
      socketReady:
        process.platform === 'win32'
          ? undefined
          : async () => existsSync(this.options.socketPath ?? defaultHerdrSocketPath(sessionName))
    })
  }

  async compatibleSchema(): Promise<HerdrApiSchema> {
    return await this.loadSchema()
  }

  private async loadSchema(): Promise<HerdrApiSchema> {
    if (!this.schema) {
      const result = await this.run(['api', 'schema', '--json'])
      const schema = JSON.parse(result) as HerdrApiSchema
      assertHerdrSchemaCompatible(schema)
      this.schema = schema
    }
    return this.schema
  }

  private async listSessions(): Promise<HerdrListedSession[]> {
    try {
      return parseHerdrSessionList(await this.run(['session', 'list', '--json']))
    } catch {
      return []
    }
  }

  private async startServer(sessionName: string): Promise<void> {
    const command = this.options.serverCommandFor
      ? await this.options.serverCommandFor(sessionName)
      : await (async () => {
          const base = await (this.options.commandFor?.(['--session', sessionName, 'server']) ?? {
            file: 'herdr',
            args: ['--session', sessionName, 'server']
          })
          return {
            ...base,
            env: herdrServerEnvironment(base.env)
          }
        })()
    await startDetachedHerdrCommand(command)
  }

  private async run(args: string[]): Promise<string> {
    const command = (await this.options.commandFor?.(args)) ?? {
      file: 'herdr',
      args
    }
    const result = await runProcess({
      program: command.file,
      args: command.args,
      env: command.env,
      timeoutMs: this.options.timeoutMs ?? 15_000
    })
    if (result.timedOut) {
      throw new Error(`herdr ${args.join(' ')} timed out`)
    }
    if (result.code === 0) {
      return result.stdout
    }
    const status =
      result.code === null ? `signal ${result.signal ?? 'unknown'}` : `code ${result.code}`
    throw new Error(result.stderr.trim() || `herdr ${args.join(' ')} exited with ${status}`)
  }
}
