import type { SshConnection } from '../ssh/ssh-connection'
import type { RemoteHostPlatform } from '../ssh/ssh-remote-platform'
import type { IPtyProvider } from './types'

export type TerminalBackendContext =
  | { kind: 'local' }
  | {
      kind: 'ssh'
      targetId: string
      connection: SshConnection
      hostPlatform?: RemoteHostPlatform
    }

export type TerminalBackendProvider = IPtyProvider & {
  dispose?: () => void
}

export type TerminalBackendAdapter = {
  readonly id: string
  wrap(fallback: TerminalBackendProvider, context: TerminalBackendContext): TerminalBackendProvider
}

export type TerminalBackendComposition = {
  provider: TerminalBackendProvider
  dispose: () => void
}

const adapters = new Map<string, TerminalBackendAdapter>()

export function registerTerminalBackendAdapter(adapter: TerminalBackendAdapter): () => void {
  if (adapters.has(adapter.id)) {
    throw new Error(`Terminal backend adapter "${adapter.id}" is already registered`)
  }
  adapters.set(adapter.id, adapter)
  return () => {
    if (adapters.get(adapter.id) === adapter) {
      adapters.delete(adapter.id)
    }
  }
}

export function composeTerminalBackendProvider(
  fallback: TerminalBackendProvider,
  context: TerminalBackendContext
): TerminalBackendComposition {
  let provider = fallback
  const ownedProviders: TerminalBackendProvider[] = []
  for (const adapter of adapters.values()) {
    const wrapped = adapter.wrap(provider, context)
    if (wrapped !== provider && wrapped !== fallback) {
      ownedProviders.push(wrapped)
    }
    provider = wrapped
  }
  return {
    provider,
    dispose: () => {
      for (const owned of ownedProviders.toReversed()) {
        owned.dispose?.()
      }
    }
  }
}

export function resetTerminalBackendAdaptersForTest(): void {
  adapters.clear()
}
