import { describe, expect, it, vi } from 'vitest'
import type { HerdrHostTransport } from './herdr-runtime-contract'
import { HerdrPtyProvider } from './herdr-pty-provider'
import type { HerdrPtyBinding } from './herdr-pty-types'

describe('HerdrPtyProvider input ordering', () => {
  it('serializes signals after pending text writes', async () => {
    let releaseText: () => void = () => {}
    const textPending = new Promise<void>((resolve) => {
      releaseText = resolve
    })
    const request = vi.fn(async (_session: string, method: string) => {
      if (method === 'pane.send_text') {
        await textPending
      }
      return { id: method, result: { type: 'ok' } }
    })
    const transport = { request } as unknown as HerdrHostTransport
    const provider = new HerdrPtyProvider(
      () => transport,
      async () => null,
      () => 'test-session'
    )
    const id = 'pty-1'
    const binding = {
      id,
      sessionName: 'test-session',
      paneId: 'pane-1',
      transport
    } as unknown as HerdrPtyBinding
    const bindings = (provider as unknown as { bindings: Map<string, HerdrPtyBinding> }).bindings
    bindings.set(id, binding)

    provider.write(id, 'first')
    const signalPending = provider.sendSignal(id, 'SIGINT')

    await vi.waitFor(() => {
      expect(request.mock.calls.map((call) => call[1])).toEqual(['pane.send_text'])
    })
    releaseText()
    await signalPending
    expect(request.mock.calls.map((call) => call[1])).toEqual(['pane.send_text', 'pane.send_keys'])
  })

  it('forwards signals for Orca fallback PTYs', async () => {
    const sendSignal = vi.fn(async () => undefined)
    const fallback = {
      spawn: vi.fn(),
      attach: vi.fn(),
      write: vi.fn(),
      writeLogical: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      shutdown: vi.fn(),
      sendSignal,
      hasPty: (id: string) => id === 'orca-fallback',
      onData: vi.fn(() => vi.fn()),
      onExit: vi.fn(() => vi.fn()),
      listProcesses: vi.fn(async () => [])
    }
    const provider = new HerdrPtyProvider(
      () => ({ request: vi.fn() }) as unknown as HerdrHostTransport,
      async () => null,
      () => 'test-session',
      undefined,
      fallback as never
    )
    await provider.sendSignal('orca-fallback', 'SIGINT')
    expect(sendSignal).toHaveBeenCalledWith('orca-fallback', 'SIGINT')
  })

  it('writes named keys to an Orca fallback that has no writeLogical', () => {
    const write = vi.fn()
    const fallback = {
      spawn: vi.fn(),
      attach: vi.fn(),
      write,
      resize: vi.fn(),
      kill: vi.fn(),
      shutdown: vi.fn(),
      sendSignal: vi.fn(),
      hasPty: (id: string) => id === 'orca-fallback',
      onData: vi.fn(() => vi.fn()),
      onExit: vi.fn(() => vi.fn()),
      listProcesses: vi.fn(async () => [])
    }
    const provider = new HerdrPtyProvider(
      () => ({ request: vi.fn() }) as unknown as HerdrHostTransport,
      async () => null,
      () => 'test-session',
      undefined,
      fallback as never
    )
    expect(provider.writeLogical('orca-fallback', { kind: 'key', name: 'enter' })).toBe(true)
    expect(write).toHaveBeenCalledWith('orca-fallback', '\r')
  })
})
