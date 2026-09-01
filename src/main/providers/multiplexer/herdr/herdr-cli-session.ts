import { runProcess, spawnProcess } from '../../../../shared/child-process/run-process'
import { buildWslExecArgs } from '../../../../shared/wsl-login-shell-command'
import { resolveWslExecutablePath } from '../../../wsl/wsl-executable-path'
import { ensureStockHerdrSession, type HerdrListedSession } from './herdr-stock-session'

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

  constructor(options: HerdrCliSessionOptions) {
    this.options = options
  }

  async ensureSession(sessionName: string): Promise<void> {
    await ensureStockHerdrSession(this.sessionPromises, sessionName, {
      listSessions: () => this.listSessions(),
      startServer: (name) => this.startServer(name),
      timeoutMs: this.options.timeoutMs
    })
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
