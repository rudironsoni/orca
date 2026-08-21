import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import type { HerdrSocketConnectionOptions } from './herdr-socket-connection'
import { herdrServerEnvironment } from './herdr-cli-session'
import { assertHerdrSchemaCompatible, type HerdrApiSchema } from './herdr-runtime-contract'

export type HerdrSocketSessionOptions = HerdrSocketConnectionOptions & {
  commandFor?: (args: string[]) => { file: string; args: string[]; env?: NodeJS.ProcessEnv }
  serverCommandFor?: (sessionName: string) => {
    file: string
    args: string[]
    env?: NodeJS.ProcessEnv
  }
}

export class HerdrSocketSessionManager {
  private readonly options: HerdrSocketSessionOptions
  private readonly sessionPromises = new Map<string, Promise<void>>()
  private schema: HerdrApiSchema | null = null

  constructor(options: HerdrSocketSessionOptions) {
    this.options = options
  }

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
    if (!this.options.commandFor) {
      return
    }
    await this.loadSchema()
    const sessions = await this.listSessions()
    if (!sessions.some((session) => session.name === sessionName && session.running)) {
      await this.startServer(sessionName)
      await this.waitForSession(sessionName)
    }
  }

  async schemaProtocol(): Promise<number> {
    return (await this.loadSchema()).protocol
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

  private async listSessions(): Promise<{ name: string; running: boolean }[]> {
    const result = await this.run(['session', 'list', '--json'])
    return this.parseHerdrSessionList(result)
  }

  private parseHerdrSessionList(stdout: string): { name: string; running: boolean }[] {
    try {
      const result = JSON.parse(stdout) as { sessions?: { name?: unknown; running?: unknown }[] }
      return (result.sessions ?? []).flatMap((session) =>
        typeof session.name === 'string'
          ? [{ name: session.name, running: session.running === true }]
          : []
      )
    } catch {
      return []
    }
  }

  private async startServer(sessionName: string): Promise<void> {
    const command =
      this.options.serverCommandFor?.(sessionName) ??
      (() => {
        const base = this.options.commandFor?.(['--session', sessionName, 'server']) ?? {
          file: 'herdr',
          args: ['--session', sessionName, 'server']
        }
        return {
          ...base,
          env: herdrServerEnvironment(base.env)
        }
      })()
    const child = spawn(command.file, command.args, {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
      ...(command.env ? { env: command.env } : {})
    })
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
        child.unref()
        finish()
      }, 100)
      child.once('error', (error) => finish(error))
      child.once('close', (code) => {
        finish(new Error(`Herdr server exited during startup with code ${code ?? 'unknown'}`))
      })
    })
  }

  private async waitForSession(sessionName: string): Promise<void> {
    const deadline = Date.now() + (this.options.timeoutMs ?? 15000)
    while (Date.now() < deadline) {
      const sessions = await this.listSessions().catch(() => [])
      if (sessions.some((session) => session.name === sessionName && session.running)) {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    throw new Error(`Timeout waiting for herdr session ${sessionName} to start`)
  }

  private async run(args: string[]): Promise<string> {
    const command = this.options.commandFor?.(args) ?? {
      file: 'herdr',
      args
    }
    return new Promise<string>((resolve, reject) => {
      const child = spawn(command.file, command.args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        ...(command.env ? { env: command.env } : {})
      })
      const stdoutDecoder = new StringDecoder('utf8')
      const stderrDecoder = new StringDecoder('utf8')
      let stdout = ''
      let stderr = ''
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
        } else {
          resolve(stdout)
        }
      }
      const timeout = setTimeout(() => {
        finish(new Error(`herdr ${args.join(' ')} timed out`))
        child.kill()
      }, this.options.timeoutMs ?? 15000)
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += stdoutDecoder.write(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += stderrDecoder.write(chunk)
      })
      child.once('error', finish)
      child.stdout.once('error', finish)
      child.stderr.once('error', finish)
      child.once('close', (code, signal) => {
        if (code === 0) {
          finish()
        } else {
          const status = code === null ? `signal ${signal ?? 'unknown'}` : `code ${code}`
          finish(new Error(stderr.trim() || `herdr ${args.join(' ')} exited with ${status}`))
        }
      })
    })
  }
}
