import { createServer, connect, type Server, type Socket } from 'node:net'
import { rmSync } from 'node:fs'
import type { ClientChannel } from 'ssh2'
import { spawnProcess, type SpawnedProcess } from '../../../../shared/child-process/run-process'
import type { SshConnection } from '../../../ssh/ssh-connection'
import { buildSshArgs } from '../../../ssh/system-ssh-args'
import { findSystemSsh } from '../../../ssh/system-ssh-binary'
import { herdrLocalRelayEndpoint } from './herdr-session-socket-path'

const FORWARD_PROBE_MS = 50
const FORWARD_TIMEOUT_MS = 5_000

export class HerdrSshSocketRelay {
  private server: Server | null = null
  private forward: SpawnedProcess | null = null
  private readonly directory: string
  readonly localSocketPath: string

  constructor(
    private readonly connection: SshConnection,
    private readonly remoteSocketPath: string
  ) {
    if (!remoteSocketPath.startsWith('/') || remoteSocketPath.includes('~')) {
      throw new Error(`Herdr remote socket path must be absolute, received ${remoteSocketPath}`)
    }
    const endpoint = herdrLocalRelayEndpoint(`ssh-${process.pid}`)
    this.directory = endpoint.directory
    this.localSocketPath = endpoint.listenPath
  }

  async listen(): Promise<string> {
    if (this.connection.usesSystemSshTransport()) {
      await this.listenWithSystemSsh()
      return this.localSocketPath
    }
    await new Promise<void>((resolve, reject) => {
      this.server = createServer((client) => {
        void this.pipe(client)
      })
      this.server.once('error', reject)
      this.server.listen(this.localSocketPath, () => {
        this.server?.off('error', reject)
        resolve()
      })
    })
    return this.localSocketPath
  }

  async dispose(): Promise<void> {
    this.server?.close()
    this.server = null
    this.forward?.kill()
    this.forward = null
    rmSync(this.directory, { recursive: true, force: true })
  }

  private async listenWithSystemSsh(): Promise<void> {
    const sshPath = findSystemSsh()
    if (!sshPath) {
      throw new Error('No system ssh binary found. Install OpenSSH to forward the Herdr socket.')
    }
    const args = buildSshArgs(this.connection.getTarget(), {
      ...this.connection.getSystemSshBuildArgsOptions(),
      suppressOrcaControlMaster: true
    })
    const forwardArgs = [
      '-N',
      '-n',
      '-o',
      'ExitOnForwardFailure=yes',
      '-L',
      `${this.localSocketPath}:${this.remoteSocketPath}`
    ]
    const destinationIndex = args.lastIndexOf('--')
    if (destinationIndex === -1) {
      args.unshift(...forwardArgs)
    } else {
      args.splice(destinationIndex, 0, ...forwardArgs)
    }
    const child = spawnProcess({
      program: sshPath,
      args,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    this.forward = child
    await waitForLocalSocket(this.localSocketPath, child)
  }

  private async pipe(client: Socket): Promise<void> {
    let channel: ClientChannel
    try {
      channel = await this.connection.forwardOutStreamLocal(this.remoteSocketPath)
    } catch (error) {
      client.destroy(error instanceof Error ? error : undefined)
      return
    }
    client.pipe(channel)
    channel.pipe(client)
    client.on('close', () => channel.close())
    channel.on('close', () => client.destroy())
  }
}

function waitForLocalSocket(listenPath: string, child: SpawnedProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = ''
    let settled = false
    let probeTimer: ReturnType<typeof setTimeout> | null = null
    const timeout = setTimeout(() => {
      finish(() => reject(new Error(`System SSH Herdr socket forward timed out: ${stderr.trim()}`)))
    }, FORWARD_TIMEOUT_MS)
    const finish = (callback: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      if (probeTimer) {
        clearTimeout(probeTimer)
      }
      child.off('error', onError)
      child.off('exit', onExit)
      child.stderr?.off('data', onStderr)
      callback()
    }
    const onStderr = (chunk: Buffer): void => {
      stderr += chunk.toString('utf8')
    }
    const onError = (error: Error): void => {
      finish(() => reject(error))
    }
    const onExit = (code: number | null): void => {
      finish(() =>
        reject(
          new Error(
            `System SSH Herdr socket forward exited${code !== null ? ` (exit ${code})` : ''}${
              stderr.trim() ? `: ${stderr.trim()}` : ''
            }`
          )
        )
      )
    }
    const probe = (): void => {
      const socket = connect(listenPath)
      socket.once('connect', () => {
        socket.destroy()
        finish(resolve)
      })
      socket.once('error', () => {
        socket.destroy()
        if (!settled) {
          probeTimer = setTimeout(probe, FORWARD_PROBE_MS)
        }
      })
    }
    child.stderr?.on('data', onStderr)
    child.once('error', onError)
    child.once('exit', onExit)
    probe()
  })
}
