import type { Store } from '../../persistence'
import { registerTerminalBackendAdapter } from '../../providers/terminal-backend-registry'
import {
  createLocalHerdrPtyProvider,
  createSshHerdrPtyProvider
} from '../../providers/multiplexer/herdr/herdr-provider-factory'

export function registerHerdrTerminalBackend(store: Store): () => void {
  return registerTerminalBackendAdapter({
    id: 'herdr',
    wrap: (fallback, context) =>
      context.kind === 'local'
        ? createLocalHerdrPtyProvider(fallback, store)
        : createSshHerdrPtyProvider(
            fallback,
            store,
            context.connection,
            context.targetId,
            context.hostPlatform
          )
  })
}
