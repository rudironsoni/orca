import { randomUUID } from 'node:crypto'
import { runProcess, spawnProcess } from '../../../../shared/child-process/run-process'
import { buildWslExecArgs } from '../../../../shared/wsl-login-shell-command'
import { resolveWslExecutablePath } from '../../../wsl/wsl-executable-path'
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
import { herdrStockCliArgs } from './herdr-stock-cli-args'
import { ensureStockHerdrSession, type HerdrListedSession } from './herdr-stock-session'
import {
  createHerdrSessionControlController,
  createHerdrSessionControlFromOpen,
  herdrSessionControlArgs,
  herdrSessionControlStreamFromProcess
} from './herdr-session-control'

export type HerdrCommand = { file: string; args: string[]; env?: NodeJS.ProcessEnv }
export type HerdrCommandFactory = (herdrArgs: string[]) => HerdrCommand | Promise<HerdrCommand>
export type { HerdrListedSession }

export function localHerdrCommand(
  executable = 'herdr',
  env?: NodeJS.ProcessEnv
): (args: string[]) => HerdrCommand {
  return (args) => ({ file: executable, args, ...(env ? { env } : {}) })
}

export function parseHerdrSessionList(stdout: string): HerdrListedSession[] {
  const result = JSON.parse(stdout) as {
    sessions?: { name?: unknown; running?: unknown }[]
  }
  return (result.sessions ?? []).flatMap((session) =>
    typeof session.name === 'string'
      ? [{ name: session.name, running: session.running === true }]
      : []
  )
}

export function herdrServerEnvironment(base: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const env = { ...process.env, ...base }
  for (const name of Object.keys(env)) {
    if (name.startsWith('HERDR_')) {
      delete env[name]
    }
  }
  return env
}

export type HerdrCliSessionOptions = {
  commandFor: HerdrCommandFactory
  serverCommandFor?: (sessionName: string) => HerdrCommand | Promise<HerdrCommand>
  timeoutMs?: number
  wslDistro?: string
}

export function herdrHostProcessSpec(
  command: HerdrCommand,
  wslDistro?: string
): { program: string; args: string[]; env?: NodeJS.ProcessEnv } {
  if (!wslDistro) {
    return { program: command.file, args: command.args, env: command.env }
  }
  return {
    program: resolveWslExecutablePath(),
    args: buildWslExecArgs(wslDistro, [command.file, ...command.args]),
    env: command.env
  }
}

export async function startDetachedHerdrCommand(
  command: HerdrCommand,
  wslDistro?: string
): Promise<void> {
  const spec = herdrHostProcessSpec(command, wslDistro)
  const child = spawnProcess({ ...spec, detached: true })
  child.unref()
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(started)
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    const started = setTimeout(() => {
      finish()
    }, 100)
    child.once('error', (error) => finish(error))
    child.once('close', (code) => {
      finish(new Error(`Herdr server exited during startup with code ${code ?? 'unknown'}`))
    })
  })
}

export class HerdrCliSessionManager {
  private readonly options: HerdrCliSessionOptions
  private readonly sessionPromises = new Map<string, Promise<void>>()
  private schema: HerdrApiSchema | null = null

  constructor(options: HerdrCliSessionOptions) {
    this.options = options
  }

  async ensureSession(sessionName: string): Promise<void> {
    await ensureStockHerdrSession(this.sessionPromises, sessionName, {
      loadSchema: () => this.loadSchema(),
      listSessions: () => this.listSessions(),
      startServer: (name) => this.startServer(name),
      timeoutMs: this.options.timeoutMs,
      afterReady: async (schema) => {
        const invocation = herdrStockCliInvocation(sessionName, 'session.snapshot', {})
        const response = invocation.parse(await this.run(invocation.args)) as HerdrResponse<{
          snapshot: { protocol: number }
        }>
        assertHerdrServerCompatible(schema, unwrapHerdrResponse(response).snapshot.protocol)
      }
    })
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
    const command = this.options.serverCommandFor
      ? await this.options.serverCommandFor(sessionName)
      : await (async () => {
          const base = await this.options.commandFor(['--session', sessionName, 'server'])
          return { ...base, env: herdrServerEnvironment(base.env) }
        })()
    await startDetachedHerdrCommand(command, this.options.wslDistro)
  }

  private async runCli(args: string[], input?: string): Promise<string> {
    const command = await this.options.commandFor(args)
    const spec = herdrHostProcessSpec(command, this.options.wslDistro)
    const result = await runProcess({
      ...spec,
      input,
      timeoutMs: this.options.timeoutMs ?? 15_000
    })
    if (result.timedOut) {
      throw new Error(`Herdr command timed out after ${this.options.timeoutMs ?? 15_000}ms`)
    }
    if (result.code === 0) {
      return result.stdout
    }
    throw new Error(result.stderr.trim() || `Herdr exited with code ${result.code ?? 'unknown'}`)
  }

  async run(args: string[]): Promise<string> {
    return await this.runCli(args)
  }
}

export type HerdrStockCliInvocation = {
  args: string[]
  parse: (stdout: string) => HerdrResponse<unknown>
}

export function herdrStockCliInvocation(
  sessionName: string,
  method: string,
  rawParams: unknown
): HerdrStockCliInvocation {
  const args = ['--session', sessionName, ...herdrStockCliArgs(method, rawParams)]

  switch (method) {
    case 'pane.read':
    case 'agent.read':
      return {
        args,
        parse: (stdout) => ({
          id: randomUUID(),
          result: { read: { text: stdout, revision: 0 } }
        })
      }
    case 'workspace.report_metadata':
    case 'pane.send_keys':
    case 'pane.send_text':
    case 'pane.report_metadata':
    case 'pane.report_agent':
    case 'pane.report_agent_session':
    case 'pane.release_agent':
    case 'pane.close':
    case 'pane.rename':
    case 'pane.focus':
    case 'agent.rename':
    case 'agent.focus':
    case 'agent.start':
    case 'agent.prompt':
    case 'agent.send_keys':
    case 'workspace.close':
    case 'workspace.focus':
    case 'tab.close':
    case 'tab.focus':
    case 'worktree.remove':
    case 'server.live_handoff':
      return okInvocation(args)
    default:
      return jsonInvocation(args)
  }
}

function jsonInvocation(args: string[]): HerdrStockCliInvocation {
  return {
    args,
    parse: (stdout) => JSON.parse(stdout.trim()) as HerdrResponse<unknown>
  }
}

function okInvocation(args: string[]): HerdrStockCliInvocation {
  return {
    args,
    parse: (stdout) =>
      stdout.trim()
        ? (JSON.parse(stdout.trim()) as HerdrResponse<unknown>)
        : { id: randomUUID(), result: { type: 'ok' } }
  }
}

export type HerdrCliHostTransportOptions = {
  commandFor: HerdrCommandFactory
  serverCommandFor?: (sessionName: string) => HerdrCommand | Promise<HerdrCommand>
  timeoutMs?: number
  wslDistro?: string
  onDisconnect?: () => void
}

export class HerdrCliHostTransport implements HerdrHostTransport {
  private readonly sessionManager: HerdrCliSessionManager

  constructor(private readonly options: HerdrCliHostTransportOptions) {
    this.sessionManager = new HerdrCliSessionManager({
      commandFor: options.commandFor,
      serverCommandFor: options.serverCommandFor,
      timeoutMs: options.timeoutMs,
      wslDistro: options.wslDistro
    })
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
    const stdout = await this.sessionManager.run(invocation.args)
    try {
      return invocation.parse(stdout) as HerdrResponse<T>
    } catch (error) {
      throw new HerdrRuntimeError(
        'herdr_invalid_response',
        `Stock Herdr returned an invalid response for ${method}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  controlTerminal(
    sessionName: string,
    target: string,
    options: HerdrTerminalControlOptions
  ): HerdrTerminalController {
    const command = this.options.commandFor(herdrSessionControlArgs(sessionName, target, options))
    if (command instanceof Promise || this.options.wslDistro) {
      return createHerdrSessionControlFromOpen(async () => {
        const resolved = await command
        const child = spawnProcess(herdrHostProcessSpec(resolved, this.options.wslDistro))
        return herdrSessionControlStreamFromProcess(child)
      })
    }
    return createHerdrSessionControlController(command)
  }

  async disconnect(): Promise<void> {
    this.options.onDisconnect?.()
  }
}
