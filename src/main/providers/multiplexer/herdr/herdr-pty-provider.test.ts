import { describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import { herdrSessionNameForProject } from '../../../../shared/horca/herdr-session-identity'
import type {
  HerdrHostTransport,
  HerdrTerminalController,
  HerdrTerminalFrame
} from './herdr-runtime-contract'
import { decodeHerdrPtyId, HerdrPtyProvider } from './herdr-pty-provider'
import { findLegacyMigrationBlockers } from './herdr-pty-types'
import { target, transport } from './herdr-pty-provider-test-transport'
import { project, singleLeafGraph, stockTransport } from './herdr-runtime-manager-test-fixtures'

function withObserve(host: ReturnType<typeof stockTransport>) {
  const transport: HerdrHostTransport = host.transport
  transport.controlTerminal = vi.fn((_session, _pane, options) => {
    const frameListeners = new Set<(frame: HerdrTerminalFrame) => void>()
    const observe: HerdrTerminalController = {
      write: vi.fn(),
      resize: vi.fn(),
      release: vi.fn(),
      onFrame: (listener) => {
        frameListeners.add(listener)
        return () => frameListeners.delete(listener)
      },
      onClosed: () => () => undefined
    }
    setTimeout(() => {
      for (const listener of frameListeners) {
        listener({
          type: 'terminal.frame',
          seq: 1,
          encoding: 'ansi',
          width: options?.cols ?? 80,
          height: options?.rows ?? 24,
          full: true,
          bytes: Buffer.from('prompt$ ', 'utf8').toString('base64')
        })
      }
    }, 0)
    return observe
  })
  return host
}

describe('HerdrPtyProvider', () => {
  it('finds legacy migration blockers', () => {
    const processes = [
      { id: 'terminal-1', worktreeId: 'repo-1::/repo', cwd: '/', title: 'Terminal' },
      { id: 'setup-1', worktreeId: 'repo-1::/repo', cwd: '/', title: 'Setup' },
      { id: 'other-1', worktreeId: 'repo-2::/other', cwd: '/', title: 'Other' }
    ]
    expect(findLegacyMigrationBlockers(processes, ['repo-1::/repo'])).toEqual([
      'terminal-1',
      'setup-1'
    ])
  })

  it('spawns a leaf on an empty stock session after reconcile', async () => {
    const host = withObserve(stockTransport())
    const graph = singleLeafGraph()
    const provider = new HerdrPtyProvider(
      () => host.transport,
      async () => ({
        project: project(),
        graph,
        identity: {
          version: 2,
          hostId: 'local',
          projectId: 'project-1',
          worktreeId: 'worktree-1',
          tabId: 'tab-1',
          leafId: 'leaf-1'
        }
      })
    )

    const spawned = await provider.spawn({
      cols: 80,
      rows: 24,
      cwd: '/repo',
      worktreeId: 'worktree-1',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1'
    })

    expect(decodeHerdrPtyId(spawned.id)).toMatchObject({
      leafId: 'leaf-1',
      paneId: 'w1:p1'
    })
  })

  it('spawns a leaf that the persisted tab layout does not name', async () => {
    const spawnLeaf = '5aba23d2-fcee-4887-9bd6-8a3235c3b1d7'
    const host = withObserve(stockTransport())
    const graph = {
      ...singleLeafGraph(),
      layoutsByTabId: {
        'tab-1': {
          root: { type: 'leaf' as const, leafId: 'leaf-old' },
          activeLeafId: 'leaf-old',
          expandedLeafId: null
        }
      }
    }
    const provider = new HerdrPtyProvider(
      () => host.transport,
      async () => ({
        project: project(),
        graph,
        identity: {
          version: 2,
          hostId: 'local',
          projectId: 'project-1',
          worktreeId: 'worktree-1',
          tabId: 'tab-1',
          leafId: spawnLeaf
        }
      })
    )

    const spawned = await provider.spawn({
      cols: 80,
      rows: 24,
      cwd: '/repo',
      worktreeId: 'worktree-1',
      tabId: 'tab-1',
      paneKey: `tab-1:${spawnLeaf}`
    })

    expect(decodeHerdrPtyId(spawned.id)?.leafId).toBe(spawnLeaf)
    expect(decodeHerdrPtyId(spawned.id)?.paneId).toBeTruthy()
  })

  it('mounts, identifies, reads, and explicitly closes a stock Herdr pane', async () => {
    const host = transport()
    const provider = new HerdrPtyProvider(
      () => host.value,
      async () => target(),
      () => 'test-session'
    )
    const spawned = await provider.spawn({
      cols: 120,
      rows: 40,
      cwd: '/repo',
      worktreeId: 'repo-1::/repo',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1'
    })

    expect(decodeHerdrPtyId(spawned.id)).toMatchObject({
      version: 2,
      leafId: 'leaf-1',
      paneId: 'p1'
    })
    expect(spawned.snapshot).toBe('prompt$ ')
    expect(await provider.getBufferSnapshot(spawned.id, { scrollbackRows: 500 })).toEqual({
      data: 'history\nprompt$ ',
      cols: 120,
      rows: 40,
      cwd: '/repo',
      seq: 7,
      source: 'headless'
    })
    await provider.shutdown(spawned.id, {})
    expect(host.requestMock).toHaveBeenCalledWith(
      herdrSessionNameForProject({ id: 'project-1' }, 'test-session'),
      'workspace.close',
      { workspaceId: 'w1' }
    )
    expect(host.value.controlTerminal).toHaveBeenCalledWith(
      herdrSessionNameForProject({ id: 'project-1' }, 'test-session'),
      'p1',
      { cols: 120, rows: 40, observe: true }
    )
  })

  it('reports live bindings to the acknowledged write path', async () => {
    const host = transport()
    const provider = new HerdrPtyProvider(
      () => host.value,
      async () => target(),
      () => 'test-session'
    )
    const spawned = await provider.spawn({
      cols: 80,
      rows: 24,
      cwd: '/repo',
      worktreeId: 'repo-1::/repo',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1'
    })
    expect(provider.hasPty(spawned.id)).toBe(true)
    expect(provider.hasPty('missing')).toBe(false)
    await provider.shutdown(spawned.id, {})
    expect(provider.hasPty(spawned.id)).toBe(false)
  })

  it('writes live keys through pane.send_text and interrupts through pane.send_keys', async () => {
    const host = transport()
    const provider = new HerdrPtyProvider(
      () => host.value,
      async () => target(),
      () => 'test-session'
    )
    const spawned = await provider.spawn({
      cols: 80,
      rows: 24,
      cwd: '/repo',
      worktreeId: 'repo-1::/repo',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1'
    })
    const controller = host.value.controlTerminal as unknown as ReturnType<typeof vi.fn>
    const spawnedController = controller.mock.results[0]?.value as
      | HerdrTerminalController
      | undefined
    if (!spawnedController) {
      throw new Error('expected a stock Herdr terminal controller')
    }
    const write = spawnedController.write as ReturnType<typeof vi.fn>
    write.mockClear()
    host.requestMock.mockClear()

    provider.write(spawned.id, 'hello')
    provider.write(spawned.id, '\r')
    provider.write(spawned.id, '\x7f')
    provider.write(spawned.id, '\x1b')
    provider.write(spawned.id, '\x01')
    provider.write(spawned.id, '\x1b[A')
    provider.writeLogical(spawned.id, { kind: 'key', name: 'ctrl+c' })
    provider.write(spawned.id, '\x03')
    await vi.waitFor(() => {
      expect(
        host.requestMock.mock.calls.filter((call) => call[1] === 'pane.send_keys')
      ).toHaveLength(2)
    })
    await vi.waitFor(() => {
      expect(
        host.requestMock.mock.calls.filter((call) => call[1] === 'pane.send_text')
      ).toHaveLength(6)
    })

    expect(write).not.toHaveBeenCalled()
    const sendText = host.requestMock.mock.calls.filter((call) => call[1] === 'pane.send_text')
    expect(sendText.map((call) => (call[2] as { text: string }).text)).toEqual([
      'hello',
      '\r',
      '\x7f',
      '\x1b',
      '\x01',
      '\x1b[A'
    ])
    const sendKeys = host.requestMock.mock.calls.filter((call) => call[1] === 'pane.send_keys')
    expect(sendKeys.map((call) => (call[2] as { keys: string[] }).keys)).toEqual([
      ['ctrl+c'],
      ['ctrl+c']
    ])
    expect(sendKeys.every((call) => (call[2] as { paneId: string }).paneId === 'p1')).toBe(true)
  })

  it('serializes text writes so terminal input cannot reorder', async () => {
    const host = transport()
    const provider = new HerdrPtyProvider(
      () => host.value,
      async () => target(),
      () => 'test-session'
    )
    const spawned = await provider.spawn({
      cols: 80,
      rows: 24,
      cwd: '/repo',
      worktreeId: 'repo-1::/repo',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1'
    })
    const baseRequest = host.requestMock.getMockImplementation()!
    let releaseFirst: () => void = () => {}
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let sendCount = 0
    host.requestMock.mockImplementation(async (session, method, params) => {
      if (method === 'pane.send_text') {
        sendCount += 1
        if (sendCount === 1) {
          await firstPending
        }
        return { id: method, result: { type: 'ok' } }
      }
      return await baseRequest(session, method, params)
    })
    host.requestMock.mockClear()

    provider.write(spawned.id, 'first')
    provider.write(spawned.id, 'second')

    await vi.waitFor(() => expect(sendCount).toBe(1))
    releaseFirst()
    await vi.waitFor(() => expect(sendCount).toBe(2))
    expect(
      host.requestMock.mock.calls
        .filter((call) => call[1] === 'pane.send_text')
        .map((call) => (call[2] as { text: string }).text)
    ).toEqual(['first', 'second'])
  })

  it('reads cwd from pane.get with the Herdr pane id', async () => {
    const host = transport()
    const provider = new HerdrPtyProvider(
      () => host.value,
      async () => target(),
      () => 'test-session'
    )
    const spawned = await provider.spawn({
      cols: 80,
      rows: 24,
      cwd: '/repo',
      worktreeId: 'repo-1::/repo',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1'
    })
    host.requestMock.mockClear()
    await expect(provider.getCwd(spawned.id)).resolves.toBe('/repo')
    expect(host.requestMock).toHaveBeenCalledWith(
      herdrSessionNameForProject({ id: 'project-1' }, 'test-session'),
      'pane.get',
      { paneId: 'p1' }
    )
    expect(
      host.requestMock.mock.calls.some((call) => {
        const params = call[2] as { paneId?: string } | undefined
        return params?.paneId === spawned.id
      })
    ).toBe(false)
  })

  it('returns the last applied size from the binding', async () => {
    const host = transport()
    const provider = new HerdrPtyProvider(
      () => host.value,
      async () => target(),
      () => 'test-session'
    )
    const spawned = await provider.spawn({
      cols: 80,
      rows: 24,
      cwd: '/repo',
      worktreeId: 'repo-1::/repo',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1'
    })
    await expect(provider.getAppliedSize(spawned.id)).resolves.toEqual({ cols: 120, rows: 40 })
    provider.resize(spawned.id, 100, 30)
    await expect(provider.getAppliedSize(spawned.id)).resolves.toEqual({ cols: 100, rows: 30 })
    const controlTerminal = host.value.controlTerminal as unknown as ReturnType<typeof vi.fn>
    const spawnedController = controlTerminal.mock.results[0]?.value as
      | HerdrTerminalController
      | undefined
    expect(spawnedController?.resize).toHaveBeenCalledWith(100, 30)
    await vi.waitFor(() => {
      expect(
        controlTerminal.mock.calls.some(
          (call) =>
            (call[2] as { cols?: number; observe?: boolean } | undefined)?.cols === 100 &&
            (call[2] as { observe?: boolean } | undefined)?.observe !== true
        )
      ).toBe(true)
    })
  })

  it('clears the local snapshot without sending keys', async () => {
    const host = transport()
    const provider = new HerdrPtyProvider(
      () => host.value,
      async () => target(),
      () => 'test-session'
    )
    const spawned = await provider.spawn({
      cols: 80,
      rows: 24,
      cwd: '/repo',
      worktreeId: 'repo-1::/repo',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1'
    })
    host.requestMock.mockClear()
    await provider.clearBuffer(spawned.id)
    expect(host.requestMock).not.toHaveBeenCalled()
  })

  it('sends SIGINT to the Herdr pane id, not the Orca pty id', async () => {
    const host = transport()
    const provider = new HerdrPtyProvider(
      () => host.value,
      async () => target(),
      () => 'test-session'
    )
    const spawned = await provider.spawn({
      cols: 80,
      rows: 24,
      cwd: '/repo',
      worktreeId: 'repo-1::/repo',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1'
    })
    host.requestMock.mockClear()
    const controller = host.value.controlTerminal as unknown as ReturnType<typeof vi.fn>
    const spawnedController = controller.mock.results[0]?.value as
      | HerdrTerminalController
      | undefined
    if (!spawnedController) {
      throw new Error('expected a stock Herdr terminal controller')
    }
    const write = spawnedController.write as ReturnType<typeof vi.fn>
    write.mockClear()
    await provider.sendSignal(spawned.id, 'SIGINT')

    expect(host.requestMock).toHaveBeenCalledWith(
      herdrSessionNameForProject({ id: 'project-1' }, 'test-session'),
      'pane.send_keys',
      { paneId: 'p1', keys: ['ctrl+c'] }
    )
    expect(write).not.toHaveBeenCalled()
    expect(
      host.requestMock.mock.calls.some((call) => {
        const params = call[2] as { paneId?: string } | undefined
        return params?.paneId === spawned.id
      })
    ).toBe(false)
  })

  it('writes a shell command through pane.send_text when no agent is launched', async () => {
    const host = transport()
    const provider = new HerdrPtyProvider(
      () => host.value,
      async () => target(),
      () => 'test-session'
    )
    await provider.spawn({
      cols: 80,
      rows: 24,
      cwd: '/repo',
      worktreeId: 'repo-1::/repo',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1',
      command: 'ls'
    })
    await vi.waitFor(() => {
      expect(host.requestMock).toHaveBeenCalledWith(
        herdrSessionNameForProject({ id: 'project-1' }, 'test-session'),
        'pane.send_text',
        { paneId: 'p1', text: 'ls\r' }
      )
    })
  })

  it('logs a rejected startup command without rejecting the spawn', async () => {
    const host = transport(false, 'pane.send_text')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const provider = new HerdrPtyProvider(
      () => host.value,
      async () => target()
    )

    await expect(
      provider.spawn({
        cols: 80,
        rows: 24,
        cwd: '/repo',
        worktreeId: 'repo-1::/repo',
        tabId: 'tab-1',
        paneKey: 'tab-1:leaf-1',
        command: 'ls'
      })
    ).resolves.toMatchObject({ id: expect.any(String) })
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to write startup command'),
        expect.any(Error)
      )
    })
    warn.mockRestore()
  })

  it('starts a stock Herdr agent instead of writing a shell command', async () => {
    const host = transport()
    const provider = new HerdrPtyProvider(
      () => host.value,
      async () => target(),
      () => 'test-session'
    )
    await provider.spawn({
      cols: 80,
      rows: 24,
      cwd: '/repo',
      worktreeId: 'repo-1::/repo',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1',
      launchAgent: 'claude',
      command: 'claude'
    })

    expect(host.requestMock).toHaveBeenCalledWith(
      herdrSessionNameForProject({ id: 'project-1' }, 'test-session'),
      'agent.start',
      expect.objectContaining({
        kind: 'claude',
        paneId: 'p1'
      })
    )
  })

  it('rejects a controller that closes before producing its first frame', async () => {
    const host = transport(true)
    const provider = new HerdrPtyProvider(
      () => host.value,
      async () => target(),
      () => 'test-session'
    )
    await expect(
      provider.spawn({
        cols: 80,
        rows: 24,
        cwd: '/repo',
        worktreeId: 'repo-1::/repo',
        tabId: 'tab-1',
        paneKey: 'tab-1:leaf-1'
      })
    ).rejects.toThrow(/closed/)
  })

  it('lists live Herdr bindings without calling pane.get', async () => {
    const host = transport()
    const provider = new HerdrPtyProvider(
      () => host.value,
      async () => target(),
      () => 'test-session'
    )
    const spawned = await provider.spawn({
      cols: 80,
      rows: 24,
      cwd: '/repo',
      worktreeId: 'repo-1::/repo',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1'
    })
    host.requestMock.mockClear()
    await expect(provider.listProcesses()).resolves.toEqual([
      {
        id: spawned.id,
        terminalHandle: 'term_p1',
        incarnationId: expect.any(String),
        cwd: '/repo',
        title: 'Herdr',
        worktreeId: 'repo-1::/repo'
      }
    ])
    expect(host.requestMock).not.toHaveBeenCalled()
  })

  it('delegates a non-Herdr spawn to the Orca fallback', async () => {
    const fallback = {
      spawn: vi.fn(async () => ({ id: 'pty-orca' })),
      attach: vi.fn(),
      shutdown: vi.fn(),
      hasPty: vi.fn(() => false),
      write: vi.fn(),
      resize: vi.fn(),
      listProcesses: vi.fn(async () => [{ id: 'pty-orca', cwd: '/', title: 'sh' }]),
      onData: vi.fn(() => () => undefined),
      onExit: vi.fn(() => () => undefined),
      onReplay: vi.fn(() => () => undefined)
    }
    const provider = new HerdrPtyProvider(
      () => transport().value,
      async () => null,
      () => 'test-session',
      undefined,
      fallback as never
    )
    await expect(
      provider.spawn({ cols: 80, rows: 24, cwd: '/repo', worktreeId: 'repo-1::/repo' })
    ).resolves.toEqual({ id: 'pty-orca' })
    expect(fallback.spawn).toHaveBeenCalled()
  })

  it('keeps the binding and rejects when Herdr close fails', async () => {
    const host = transport()
    const provider = new HerdrPtyProvider(
      () => host.value,
      async () => target(),
      () => 'test-session'
    )
    const spawned = await provider.spawn({
      cols: 80,
      rows: 24,
      cwd: '/repo',
      worktreeId: 'repo-1::/repo',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1'
    })
    host.requestMock.mockImplementation(async (_session: string, method: string) => {
      if (method === 'workspace.close' || method === 'pane.close') {
        return { id: method, error: { code: 'busy', message: 'still attached' } }
      }
      if (method === 'pane.get') {
        return {
          id: method,
          result: { pane: { paneId: 'p1', workspaceId: 'w1' } }
        }
      }
      if (method === 'pane.list') {
        return { id: method, result: { panes: [{ paneId: 'p1' }] } }
      }
      return { id: method, result: { type: 'ok' } }
    })
    await expect(provider.shutdown(spawned.id, {})).rejects.toThrow('still attached')
    expect(provider.hasPty(spawned.id)).toBe(true)
  })

  it('notifies write-unavailable listeners for rejected text and named-key writes', async () => {
    const host = transport()
    const provider = new HerdrPtyProvider(
      () => host.value,
      async () => target()
    )
    const spawned = await provider.spawn({
      cols: 80,
      rows: 24,
      cwd: '/repo',
      worktreeId: 'repo-1::/repo',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1'
    })
    host.requestMock.mockRejectedValue(new Error('transport gone'))
    const unavailable = vi.fn()
    provider.onWriteUnavailable(unavailable)

    provider.write(spawned.id, 'hello')
    provider.writeLogical(spawned.id, { kind: 'key', name: 'ctrl+c' })

    await vi.waitFor(() => expect(unavailable).toHaveBeenCalledTimes(2))
    expect(unavailable).toHaveBeenCalledWith({ id: spawned.id })
  })

  it('releases every binding during killAll and disconnects captured transports on dispose', async () => {
    const host = transport()
    const disconnect = vi.fn()
    host.value.disconnect = disconnect
    const provider = new HerdrPtyProvider(
      () => host.value,
      async () => target()
    )
    const spawned = await provider.spawn({
      cols: 80,
      rows: 24,
      cwd: '/repo',
      worktreeId: 'repo-1::/repo',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1'
    })
    const controller = (host.value.controlTerminal as unknown as ReturnType<typeof vi.fn>).mock
      .results[0]?.value as HerdrTerminalController

    provider.killAll()
    expect(provider.hasPty(spawned.id)).toBe(false)
    expect(controller.release).toHaveBeenCalled()

    const next = await provider.spawn({
      cols: 80,
      rows: 24,
      cwd: '/repo',
      worktreeId: 'repo-1::/repo',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1'
    })
    expect(provider.hasPty(next.id)).toBe(true)
    ;(provider as unknown as { managers: Map<string, unknown> }).managers.clear()
    provider.dispose()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('delegates SSH reconnect attach and logical writes to the Orca fallback', async () => {
    const attachForReconnect = vi.fn().mockResolvedValue({ incarnationId: 'inc-1' })
    const write = vi.fn()
    const getAppliedSize = vi.fn().mockResolvedValue({ cols: 80, rows: 24 })
    const fallback = {
      spawn: vi.fn(),
      attach: vi.fn(),
      write,
      resize: vi.fn(),
      shutdown: vi.fn(),
      sendSignal: vi.fn(),
      attachForReconnect,
      getAppliedSize,
      hasPty: (id: string) => id === 'pty-1',
      onData: vi.fn(() => vi.fn()),
      onExit: vi.fn(() => vi.fn()),
      onReplay: vi.fn(() => vi.fn()),
      listProcesses: vi.fn(async () => [])
    }
    const provider = new HerdrPtyProvider(
      () => transport().value,
      async () => null,
      () => 'test-session',
      undefined,
      fallback as never
    )

    await expect(
      provider.attachForReconnect('pty-1', { paneKey: 'leaf-1' }, { kind: 'fresh' })
    ).resolves.toEqual({ incarnationId: 'inc-1' })
    expect(attachForReconnect).toHaveBeenCalledWith(
      'pty-1',
      { paneKey: 'leaf-1' },
      { kind: 'fresh' }
    )
    expect(provider.writeLogical('pty-1', { kind: 'key', name: 'enter' })).toBe(true)
    expect(write).toHaveBeenCalledWith('pty-1', '\r')
    await expect(provider.getAppliedSize('pty-1')).resolves.toEqual({ cols: 80, rows: 24 })
  })
})
