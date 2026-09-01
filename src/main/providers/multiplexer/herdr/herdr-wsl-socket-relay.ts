import { createServer, type Server, type Socket } from 'node:net'
import { rmSync } from 'node:fs'
import { spawnProcess, type SpawnedProcess } from '../../../../shared/child-process/run-process'
import { buildWslExecArgs } from '../../../../shared/wsl-login-shell-command'
import { runWslProcess } from '../../../wsl/wsl-runner'
import { resolveWslExecutablePath } from '../../../wsl/wsl-executable-path'
import { HerdrRuntimeError } from './herdr-runtime-contract'
import { herdrLocalRelayEndpoint } from './herdr-session-socket-path'

const NODE_STDIO_BRIDGE = [
  'const net=require("net");',
  'const socket=net.connect(process.argv[1]);',
  'process.stdin.pipe(socket);',
  'socket.pipe(process.stdout);',
  'socket.on("close",function(){process.exit(0)});',
  'socket.on("error",function(){process.exit(1)});'
].join('')

const nodeByDistro = new Map<string, string>()

export function clearWslHerdrNodeCache(): void {
  nodeByDistro.clear()
}

export async function resolveWslNodeExecutable(distro: string): Promise<string> {
  const cached = nodeByDistro.get(distro)
  if (cached) {
    return cached
  }
  const result = await runWslProcess({
    loginPath: 'preferred',
    distro,
    script: [
      '_orca_node=$(command -v node 2>/dev/null || true)',
      'case "$_orca_node" in /*) [ -x "$_orca_node" ] || exit 127 ;; *) exit 127 ;; esac',
      'printf %s "$_orca_node"'
    ].join('\n'),
    timeoutMs: 10_000,
    maxOutputBytes: 64 * 1024
  })
  const path = result.stdout.trim()
  if (
    result.timedOut ||
    result.code !== 0 ||
    !path.startsWith('/') ||
    path.includes('\n') ||
    path.includes('\r')
  ) {
    throw new HerdrRuntimeError(
      'herdr_unavailable',
      `Node.js is not on the WSL login PATH for distro ${distro}`
    )
  }
  nodeByDistro.set(distro, path)
  return path
}

export class HerdrWslSocketRelay {
  private server: Server | null = null
  private nodePath: string | null = null
  private readonly directory: string
  readonly localSocketPath: string

  constructor(
    private readonly distro: string,
    sessionName: string,
    private readonly remoteSocketPath: string,
    platform: NodeJS.Platform = process.platform
  ) {
    if (!remoteSocketPath.startsWith('/') || remoteSocketPath.includes('~')) {
      throw new Error(`Herdr WSL socket path must be absolute, received ${remoteSocketPath}`)
    }
    const endpoint = herdrLocalRelayEndpoint(`${distro}-${sessionName}`, platform)
    this.directory = endpoint.directory
    this.localSocketPath = endpoint.listenPath
  }

  async listen(): Promise<string> {
    this.nodePath = await resolveWslNodeExecutable(this.distro)
    await new Promise<void>((resolve, reject) => {
      this.server = createServer((client) => {
        this.pipe(client)
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
    rmSync(this.directory, { recursive: true, force: true })
  }

  private pipe(client: Socket): void {
    const nodePath = this.nodePath
    if (!nodePath) {
      client.destroy()
      return
    }
    let child: SpawnedProcess
    try {
      child = spawnProcess({
        program: resolveWslExecutablePath(),
        args: buildWslExecArgs(this.distro, [
          nodePath,
          '-e',
          NODE_STDIO_BRIDGE,
          this.remoteSocketPath
        ])
      })
    } catch (error) {
      client.destroy(error instanceof Error ? error : undefined)
      return
    }
    if (!child.stdin || !child.stdout) {
      child.kill()
      client.destroy()
      return
    }
    client.pipe(child.stdin)
    child.stdout.pipe(client)
    client.on('close', () => child.kill())
    child.on('close', () => client.destroy())
    child.on('error', () => client.destroy())
  }
}
