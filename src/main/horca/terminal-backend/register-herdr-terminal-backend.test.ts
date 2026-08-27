import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../../persistence'
import {
  composeTerminalBackendProvider,
  resetTerminalBackendAdaptersForTest
} from '../../providers/terminal-backend-registry'
import type { IPtyProvider } from '../../providers/types'
import { registerHerdrTerminalBackend } from './register-herdr-terminal-backend'

const providers = vi.hoisted(() => ({
  local: { dispose: vi.fn() },
  ssh: { dispose: vi.fn() }
}))

vi.mock('../../providers/multiplexer/herdr/herdr-provider-factory', () => ({
  createLocalHerdrPtyProvider: vi.fn(() => providers.local),
  createSshHerdrPtyProvider: vi.fn(() => providers.ssh)
}))

describe('registerHerdrTerminalBackend', () => {
  beforeEach(() => {
    resetTerminalBackendAdaptersForTest()
    vi.clearAllMocks()
  })

  it('wraps local and SSH providers without changing the core registry', () => {
    const unregister = registerHerdrTerminalBackend({} as Store)
    const fallback = {} as IPtyProvider

    const local = composeTerminalBackendProvider(fallback, { kind: 'local' })
    const ssh = composeTerminalBackendProvider(fallback, {
      kind: 'ssh',
      targetId: 'host',
      connection: {} as never
    })

    expect(local.provider).toBe(providers.local)
    expect(ssh.provider).toBe(providers.ssh)
    local.dispose()
    ssh.dispose()
    expect(providers.local.dispose).toHaveBeenCalledOnce()
    expect(providers.ssh.dispose).toHaveBeenCalledOnce()

    unregister()
    expect(composeTerminalBackendProvider(fallback, { kind: 'local' }).provider).toBe(fallback)
  })
})
