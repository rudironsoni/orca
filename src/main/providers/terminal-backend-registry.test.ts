import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IPtyProvider } from './types'
import {
  composeTerminalBackendProvider,
  registerTerminalBackendAdapter,
  resetTerminalBackendAdaptersForTest
} from './terminal-backend-registry'

afterEach(() => resetTerminalBackendAdaptersForTest())

describe('terminal backend registry', () => {
  it('returns the fallback when no adapter is registered', () => {
    const fallback = {} as IPtyProvider
    expect(composeTerminalBackendProvider(fallback, { kind: 'local' }).provider).toBe(fallback)
  })

  it('composes adapters in registration order and disposes wrappers in reverse order', () => {
    const events: string[] = []
    const fallback = {} as IPtyProvider
    const first = {
      dispose: () => {
        events.push('dispose-first')
      }
    } as unknown as IPtyProvider & { dispose: () => void }
    const second = {
      dispose: () => {
        events.push('dispose-second')
      }
    } as unknown as IPtyProvider & { dispose: () => void }
    const firstWrap = vi.fn(() => first)
    const secondWrap = vi.fn(() => second)
    registerTerminalBackendAdapter({ id: 'first', wrap: firstWrap })
    registerTerminalBackendAdapter({ id: 'second', wrap: secondWrap })

    const composition = composeTerminalBackendProvider(fallback, { kind: 'local' })

    expect(firstWrap).toHaveBeenCalledWith(fallback, { kind: 'local' })
    expect(secondWrap).toHaveBeenCalledWith(first, { kind: 'local' })
    expect(composition.provider).toBe(second)
    composition.dispose()
    expect(events).toEqual(['dispose-second', 'dispose-first'])
  })

  it('rejects duplicate adapter ids and unregisters by identity', () => {
    const adapter = { id: 'herdr', wrap: (provider: IPtyProvider) => provider }
    const unregister = registerTerminalBackendAdapter(adapter)
    expect(() => registerTerminalBackendAdapter(adapter)).toThrow('already registered')
    unregister()
    expect(() => registerTerminalBackendAdapter(adapter)).not.toThrow()
  })
})
