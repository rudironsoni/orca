import { describe, expect, it, vi } from 'vitest'
import type { IPtyProvider, PtyBackgroundStreamEvent } from '../../types'
import { HerdrPtyProvider } from './herdr-pty-provider'
import { HerdrPtyProviderIo } from './herdr-pty-provider-io'
import type { HerdrHostTransport } from './herdr-runtime-contract'

class TestHerdrPtyProviderIo extends HerdrPtyProviderIo {
  constructor(fallback: IPtyProvider) {
    super()
    this.fallback = fallback
  }
}

function createFallbackProvider(): IPtyProvider {
  return {
    spawn: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    getCwd: vi.fn().mockResolvedValue('/fallback-cwd'),
    getForegroundProcess: vi.fn().mockResolvedValue('zsh'),
    confirmForegroundProcess: vi.fn().mockResolvedValue('zsh'),
    hasChildProcesses: vi.fn().mockResolvedValue(true),
    setPtyBackgrounded: vi.fn(),
    getBufferSnapshot: vi.fn().mockResolvedValue({ data: 'fallback-buffer', lastActivityAt: 99 }),
    canProvideAuthoritativeBufferSnapshot: vi.fn().mockReturnValue(true),
    clearBuffer: vi.fn(),
    inspectProcess: vi.fn().mockResolvedValue({
      foregroundProcess: 'zsh',
      hasChildProcesses: true
    })
  } as unknown as IPtyProvider
}

describe('HerdrPtyProviderIo fallback inspection', () => {
  it('forwards inspection and backgrounding to the fallback for non-Herdr PTY ids', async () => {
    const fallback = createFallbackProvider()
    const provider = new TestHerdrPtyProviderIo(fallback)

    await expect(provider.getForegroundProcess('orca-pty-1')).resolves.toBe('zsh')
    expect(fallback.getForegroundProcess).toHaveBeenCalledWith('orca-pty-1')

    await expect(provider.hasChildProcesses('orca-pty-1')).resolves.toBe(true)
    expect(fallback.hasChildProcesses).toHaveBeenCalledWith('orca-pty-1')

    await expect(provider.getCwd('orca-pty-1')).resolves.toBe('/fallback-cwd')
    expect(fallback.getCwd).toHaveBeenCalledWith('orca-pty-1')

    await expect(provider.getBufferSnapshot('orca-pty-1')).resolves.toEqual({
      data: 'fallback-buffer',
      lastActivityAt: 99
    })
    expect(fallback.getBufferSnapshot).toHaveBeenCalledWith('orca-pty-1', undefined)
    expect(provider.canProvideAuthoritativeBufferSnapshot('orca-pty-1')).toBe(true)

    provider.setPtyBackgrounded('orca-pty-1', true)
    expect(fallback.setPtyBackgrounded).toHaveBeenCalledWith('orca-pty-1', true)

    await expect(provider.confirmForegroundProcess('orca-pty-1')).resolves.toBe('zsh')
    expect(fallback.confirmForegroundProcess).toHaveBeenCalledWith('orca-pty-1')

    await provider.clearBuffer('orca-pty-1')
    expect(fallback.clearBuffer).toHaveBeenCalledWith('orca-pty-1')
  })

  it('does not inspect the fallback for Herdr-owned ids', async () => {
    const fallback = createFallbackProvider()
    const provider = new TestHerdrPtyProviderIo(fallback)

    await expect(provider.getForegroundProcess('herdr:session-1')).resolves.toBeNull()
    expect(fallback.getForegroundProcess).not.toHaveBeenCalled()

    provider.setPtyBackgrounded('herdr:session-1', true)
    expect(fallback.setPtyBackgrounded).not.toHaveBeenCalled()
  })
})

describe('HerdrPtyProvider fallback background stream', () => {
  it('re-emits fallback keep-tail facts to local provider listeners', async () => {
    let emitBackground: ((payload: PtyBackgroundStreamEvent) => void) | undefined
    const fallback = {
      spawn: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      shutdown: vi.fn(),
      sendSignal: vi.fn(),
      hasPty: (id: string) => id === 'orca-pty-1',
      onData: vi.fn(() => vi.fn()),
      onExit: vi.fn(() => vi.fn()),
      onReplay: vi.fn(() => vi.fn()),
      onBackgroundStreamEvent: vi.fn((callback: (payload: PtyBackgroundStreamEvent) => void) => {
        emitBackground = callback
        return () => undefined
      }),
      inspectProcess: vi.fn().mockResolvedValue({
        foregroundProcess: 'zsh',
        hasChildProcesses: false
      }),
      confirmShellForeground: vi.fn().mockResolvedValue(true),
      listProcesses: vi.fn(async () => [])
    }
    const provider = new HerdrPtyProvider(
      () => ({ request: vi.fn() }) as unknown as HerdrHostTransport,
      async () => null,
      () => 'test-session',
      undefined,
      fallback as never
    )
    const seen: PtyBackgroundStreamEvent[] = []
    provider.onBackgroundStreamEvent((payload) => {
      seen.push(payload)
    })

    const gap: PtyBackgroundStreamEvent = {
      id: 'orca-pty-1',
      kind: 'dataGap',
      droppedChars: 42
    }
    emitBackground?.(gap)
    expect(seen).toEqual([gap])
    await expect(provider.inspectProcess('orca-pty-1')).resolves.toEqual({
      foregroundProcess: 'zsh',
      hasChildProcesses: false
    })
    expect(fallback.inspectProcess).toHaveBeenCalledWith('orca-pty-1')
    await expect(provider.confirmShellForeground('orca-pty-1')).resolves.toBe(true)
    expect(fallback.confirmShellForeground).toHaveBeenCalledWith('orca-pty-1')
  })
})
