# Horca releases

Horca publishes stable and beta channels through GitHub Releases and
`rudironsoni/homebrew-tap`. Release tags are internal immutable identifiers.
People do not create or manage them.

## Stable

Each successful push to Horca `main` starts `Horca: Stable Release`. The
workflow validates the exact source SHA, builds signed and notarized macOS DMGs,
creates `v<orca-core>-horca.<N>` and publishes the GitHub release. The Horca
Maintenance App then dispatches an immediate update of `Casks/horca.rb`.

Stable omits Windows until Horca has its own Windows signing certificate.

Install or upgrade stable:

```bash
brew install --cask rudironsoni/tap/horca
brew upgrade --cask rudironsoni/tap/horca
```

## Beta

Run `Horca: Beta Release` in GitHub Actions. Enter a non-main branch name or an
exact 40-character commit SHA from this repository. The workflow rejects the
current `main` SHA, validates the selected commit, creates
`v<orca-core>-horca-beta.<N>`, and updates `Casks/horca@beta.rb`.

Beta includes an unsigned Windows installer. GitHub labels the release as a
prerelease. Homebrew installs only the signed and notarized macOS build.

Install beta:

```bash
brew install --cask rudironsoni/tap/horca@beta
```

Stable and beta conflict, so uninstall one channel before installing the other.

## Recovery

Release allocation is idempotent by source SHA. A rerun reuses an existing tag.
If the GitHub release already exists, the workflow exits without rebuilding it.

The tap also checks both channels at `0 * * * *` and can be run manually. The
hourly run repairs a missed dispatch. The tap never selects a version by
publication date, never downgrades a cask, and validates release checksums
before it changes `main`.

Required Orca repository secrets:

- `MAC_CERTS`
- `MAC_CERTS_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
- `FORK_SYNC_PAT`, with contents access to `rudironsoni/orca`
- `HORCA_APP_ID` and `HORCA_APP_PRIVATE_KEY` in the `horca-maintenance`
  environment. The App installation needs access to `rudironsoni/homebrew-tap`.
