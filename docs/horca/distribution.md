# Horca distribution identity

`src/shared/distribution-identity.ts` is the source of runtime identity. `src/shared/distribution-identity.json` mirrors it for CommonJS packaging code. A test requires both definitions to match.

| Surface | Orca | Horca |
| --- | --- | --- |
| Product | Orca | Horca |
| App ID and AUMID | `com.stablyai.orca` | `com.rudironsoni.horca` |
| URL protocol | `orca:` | `horca:` |
| Public CLI | `orca` | `horca` |
| Local state | `~/.orca` | `~/.horca` |
| Windows executable | `Orca.exe` | `Horca.exe` |
| Windows terminal daemon | `orca-terminal-daemon.exe` | `horca-terminal-daemon.exe` |
| Linux executable | `orca-ide` | `horca-ide` |
| In-app updater | enabled | disabled |

The build selects Horca with `ORCA_DOWNSTREAM_BUILD=1`. Do not rename Orca implementation types, files, or internal APIs. Use `getDistributionIdentity()` only for a real OS, storage, protocol, packaging, or user-facing product identity.

These paths stay shared because they are interoperability surfaces:

- Per-repository `.orca/` metadata.
- `~/.orca/agent-hooks` and its lock.
- Remote `~/.orca-relay` and WSL state.

Herdr settings are stored in `horca-terminal-settings.json` beside the active Horca profile data file. The default backend is Herdr. This sidecar keeps Herdr fields out of Orca's `GlobalSettings` and `Project` schemas.
