import type { Store } from '../../persistence'
import { registerTerminalBackendAdapter } from '../../providers/terminal-backend-registry'
import {
  createLocalHerdrPtyProvider,
  createSshHerdrPtyProvider
} from '../../providers/multiplexer/herdr/herdr-provider-factory'
import type { HorcaTerminalSettingsSource } from './horca-terminal-settings'

export function registerHerdrTerminalBackend(
  store: Store,
  settings: HorcaTerminalSettingsSource
): () => void {
  return registerTerminalBackendAdapter({
    id: 'herdr',
    wrap: (fallback, context) =>
      context.kind === 'local'
        ? createLocalHerdrPtyProvider(fallback, store, settings)
        : createSshHerdrPtyProvider(
            fallback,
            store,
            context.connection,
            context.targetId,
            context.hostPlatform,
            settings
          )
  })
}
