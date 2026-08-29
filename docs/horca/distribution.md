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

Herdr settings are stored in `~/.horca/terminal-backends.json`. New Horca profiles default to the bundled Herdr backend. Existing profiles keep Orca until the user selects Herdr. This sidecar keeps Herdr fields out of Orca's `GlobalSettings` and `Project` schemas.

## Herdr integration

Horca can use Herdr 0.8.2 as its terminal multiplexer. The integration maps each Horca project, folder workspace, worktree, tab, and pane to Herdr state. Orca remains available as a backend.

Horca packages the pinned Herdr release for macOS, Linux, and Windows x64. The release assets are verified with the SHA-256 values in `config/horca/herdr-version.json`. Windows packages include the ConPTY files from the official Herdr archive.

Settings support these choices:

- The global backend can be Orca or Herdr.
- Each project can inherit the global backend or select Orca or Herdr.
- Each Herdr project can use a named session.
- Floating terminals can inherit the global backend or select their own backend.
- The Herdr Settings rows are visible only when Herdr is the global backend.
- The binary source can be bundled, `PATH`, or a custom path.

The Settings health check verifies both `herdr --version` and the required stock API schema. It reports an incompatible binary before the first terminal starts.

All Herdr floating terminals use one reserved Horca project and workspace binding. The first floating terminal creates that workspace. Local floating workspaces start in the local user home directory. Remote floating workspaces omit `cwd`, so the remote Herdr server selects the remote user home directory.

### Runtime paths

| Execution host | Transport | Refresh |
| --- | --- | --- |
| Local | Herdr socket API and terminal session control | Native event subscription |
| WSL | Herdr CLI inside the selected distribution | Snapshot change polling |
| SSH, system OpenSSH or ssh2 | Remote Herdr CLI through Horca's authenticated SSH connection | Snapshot change polling |

Herdr 0.8.2 restricts `herdr --remote` to the interactive Herdr TUI. It rejects API subcommands with `--remote can only be used with the default launch command`. Horca therefore cannot use `herdr --remote` as a pane-level API transport. Horca uses the same remote Herdr server model through its existing SSH execution boundary. A user can still run `herdr --remote <target>` in a normal terminal to open the full Herdr TUI.

The managed binary is local to the Horca package. SSH and WSL hosts must provide Herdr on `PATH`, or use a custom executable path.

Windows can run the local Herdr backend. Herdr 0.8.2 does not support Windows as a remote host, so Horca reports an error and asks the user to select Orca for that host.

### Surface synchronization

Horca and Herdr synchronize these surfaces:

- Workspace, worktree, tab, and pane creation.
- Stable ownership tokens for Horca-managed workspaces and panes.
- Tabs and panes created in Herdr, including ownerless multi-pane tabs.
- Recursive split layouts with more than two panes.
- Focus, zoom, split ratio, tab rename, tab close, and pane exit changes.
- Live ANSI terminal frames, input, resize, reconnect, and process restart.
- Herdr agent discovery, state, native session references, reads, waits, prompts, and focus.
- Herdr worktree, notification, metadata, pane movement, and layout API methods.

Herdr-backed terminal tabs show a quiet `Herdr` badge. The badge uses the existing outline badge and theme tokens.

Herdr's `pane.graphics.*` layers belong to the native Herdr client UI. Herdr 0.8.2 does not expose them through its CLI or terminal observer stream, so Horca cannot render those layers in an xterm pane. ANSI output and terminal image protocols that reach the terminal stream keep using Horca's normal renderer.

### Verification

Use these checks:

```bash
pnpm tc:node
pnpm tc:web
pnpm test src/main/horca/terminal-backend src/main/providers/multiplexer/herdr config/horca
node config/horca/scripts/run-herdr-stock-integration.mjs
node config/horca/verify-packaged-distribution.mjs dist
node config/horca/smoke-packaged-distribution.mjs <packaged-horca-executable>
```

The unit suite covers settings migration, backend selection, binary resolution, API compatibility, transport refresh, layout conversion, surface import, remote-host rules, and packaging resources. The stock integration suite uses an isolated home and exact test session names. The packaged CDP smoke verifies conditional Settings UI, bundled binary health, Herdr PTY output, restart persistence, and Horca state isolation.
