import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDistributionIdentity } from '../shared/distribution-identity'

/**
 * Root directory for distribution-owned local application state:
 * official -> ~/.orca, horca -> ~/.horca.
 *
 * Side-by-side installs must never share state that either app writes for
 * itself — credential stores and safeStorage-encrypted files especially, since
 * each distribution encrypts with its own Keychain/DPAPI identity and would
 * corrupt the other's files by cross-writing them.
 *
 * Deliberately NOT routed through this root (shared on purpose):
 * - `~/.orca/agent-hooks` and its install lock: a cross-instance surface with
 *   its own registry + locking, already shared by dev/local/packaged
 *   instances; third-party agent configs embed these script paths.
 * - Per-repo `.orca/` directories: project metadata that must stay compatible
 *   across every client that opens the repo.
 * - Remote-host and WSL-guest `~/.orca*` paths: owned by the execution host's
 *   relay deployment, not by the local app identity.
 */
export function getLocalStateRoot(homePath: string = homedir()): string {
  return join(homePath, getDistributionIdentity().stateRootDirName)
}
