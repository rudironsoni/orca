import { EventEmitter } from 'node:events'
import { createServer, connect } from 'node:net'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { herdrSessionSocketPath } from './herdr-session-socket-path'
import { HerdrSshSocketRelay } from './herdr-ssh-socket-relay'
import { HerdrWslSocketRelay, clearWslHerdrNodeCache } from './herdr-wsl-socket-relay'
import type { SshConnection } from '../../../ssh/ssh-connection'

const { spawnProcessMock, runWslProcessMock } = vi.hoisted(() => ({
  spawnProcessMock: vi.fn(),
  runWslProcessMock: vi.fn()
}))

vi.mock('../../../../shared/child-process/run-process', () => ({
  spawnProcess: spawnProcessMock,
  runProcess: vi.fn()
}))

vi.mock('../../../wsl/wsl-runner', () => ({
  runWslProcess: runWslProcessMock
}))

vi.mock('../../../wsl/wsl-executable-path', () => ({
  resolveWslExecutablePath: () => 'wsl.exe'
}))

vi.mock('../../../ssh/system-ssh-binary', () => ({
  findSystemSsh: () => '/usr/bin/ssh'
}))

vi.mock('../../../ssh/system-ssh-args', () => ({
  buildSshArgs: () => ['ada@box']
}))

const relays: { dispose(): Promise<void> }[] = []

afterEach(async () => {
  spawnProcessMock.mockReset()
  runWslProcessMock.mockReset()
  clearWslHerdrNodeCache()
  await Promise.all(relays.splice(0).map((relay) => relay.dispose()))
})

describe('herdrSessionSocketPath', () => {
  it('joins the stock POSIX socket path', () => {
    expect(herdrSessionSocketPath('/home/ada/.config', 'orca')).toBe(
      '/home/ada/.config/herdr/sessions/orca/herdr.sock'
    )
  })

  it('rejects a relative config home', () => {
    expect(() => herdrSessionSocketPath('~/.config', 'orca')).toThrow('absolute POSIX path')
  })
})

describe('HerdrSshSocketRelay', () => {
  it('forwards each local accept over stream-local', async () => {
    const remote = new PassThrough()
    const channel = Object.assign(remote, {
      close: vi.fn(() => remote.end())
    })
    const forwardOutStreamLocal = vi.fn(async () => channel)
    const connection = {
      usesSystemSshTransport: () => false,
      forwardOutStreamLocal
    } as unknown as SshConnection
    const relay = new HerdrSshSocketRelay(
      connection,
      '/home/ada/.config/herdr/sessions/orca/herdr.sock'
    )
    relays.push(relay)
    await relay.listen()

    const client = await new Promise<ReturnType<typeof connect>>((resolve, reject) => {
      const socket = connect(relay.localSocketPath)
      socket.once('connect', () => resolve(socket))
      socket.once('error', reject)
    })
    await vi.waitFor(() => {
      expect(forwardOutStreamLocal).toHaveBeenCalledWith(
        '/home/ada/.config/herdr/sessions/orca/herdr.sock'
      )
    })
    client.end()
  })

  it('rejects a tilde remote path before listening', () => {
    const connection = {
      usesSystemSshTransport: () => false,
      forwardOutStreamLocal: vi.fn()
    } as unknown as SshConnection
    expect(
      () => new HerdrSshSocketRelay(connection, '~/.config/herdr/sessions/orca/herdr.sock')
    ).toThrow('must be absolute')
  })

  it('uses OpenSSH -L for system SSH instead of a guest interpreter', async () => {
    const child = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      kill: vi.fn()
    })
    spawnProcessMock.mockReturnValue(child)
    const connection = {
      usesSystemSshTransport: () => true,
      getTarget: () => ({ host: 'box' }),
      getSystemSshBuildArgsOptions: () => ({})
    } as unknown as SshConnection
    const remotePath = '/home/ada/.config/herdr/sessions/orca/herdr.sock'
    const relay = new HerdrSshSocketRelay(connection, remotePath)
    relays.push(relay)
    const probe = createServer()
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject)
      probe.listen(relay.localSocketPath, () => resolve())
    })
    try {
      await relay.listen()
    } finally {
      probe.close()
    }
    const spec = spawnProcessMock.mock.calls[0]?.[0] as { program: string; args: string[] }
    expect(spec.program).toBe('/usr/bin/ssh')
    expect(spec.args).toContain('-L')
    expect(spec.args).toContain(`${relay.localSocketPath}:${remotePath}`)
    expect(spec.args.join(' ')).not.toMatch(/python/)
  })
})

describe('HerdrWslSocketRelay', () => {
  it('splices through guest Node, not Python', async () => {
    runWslProcessMock.mockResolvedValue({
      environmentResolved: true,
      code: 0,
      stdout: '/usr/bin/node',
      stderr: '',
      timedOut: false
    })
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      kill: vi.fn()
    })
    spawnProcessMock.mockReturnValue(child)
    const relay = new HerdrWslSocketRelay(
      'Ubuntu',
      'orca',
      '/home/ada/.config/herdr/sessions/orca/herdr.sock'
    )
    relays.push(relay)
    await relay.listen()
    const client = await new Promise<ReturnType<typeof connect>>((resolve, reject) => {
      const socket = connect(relay.localSocketPath)
      socket.once('connect', () => resolve(socket))
      socket.once('error', reject)
    })
    await vi.waitFor(() => {
      expect(spawnProcessMock).toHaveBeenCalled()
    })
    const spec = spawnProcessMock.mock.calls[0]?.[0] as { program: string; args: string[] }
    expect(spec.program).toBe('wsl.exe')
    expect(spec.args).toContain('/usr/bin/node')
    expect(spec.args).toContain('-e')
    expect(spec.args.join(' ')).not.toMatch(/python/)
    client.end()
  })
})
