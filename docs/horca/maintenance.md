# Horca fork maintenance

Horca is a downstream Orca distribution. `main` is a linear patch stack on the exact `stablyai/orca:main` source used by the latest maintenance run.

## Branch ownership

- `main` is the released Horca patch stack. Automation maintains it.
- `upstream/main` is the unmodified `stablyai/orca` reference.
- Horca features start from `main`.
- Upstream contributions start from `upstream/main`.

Never open an upstream pull request from Horca `main`. It contains Horca identity and Herdr changes.

## Autonomous upstream sync

`.github/workflows/horca_sync.yml` runs at minute zero of every hour. It needs no approval.

1. It fetches `stablyai/orca:main` without pruning tags.
2. It rebases the Horca patch stack onto the exact fetched SHA.
3. It pushes `maintenance/rebase-<sha>` as a candidate.
4. It runs the full Horca validation profile on that exact candidate SHA.
5. The Horca Maintenance GitHub App verifies the remote lease and replaces `main` with the tested SHA.
6. It deletes the candidate branch after promotion.

The App is the only permanent actor that can bypass the non-fast-forward rule on `main`. The `horca-maintenance` environment stores `HORCA_APP_ID` and `HORCA_APP_PRIVATE_KEY`. It must not require a reviewer because sync is autonomous.

If rebase fails, `main` stays unchanged. The workflow keeps the partial candidate branch, uploads the conflict paths and range-diff, and creates or updates one `sync-conflict` issue.

## Conflict recovery

Start from the failed candidate information. Replay the same patch stack on the recorded upstream SHA. Resolve only the failed topic, then run:

```bash
node config/horca/scripts/check-patch-stack.mjs
node config/horca/scripts/check-overlay-policy.mjs
pnpm tc
```

Push the repaired patch stack to `main` only with an exact `--force-with-lease`. Keep the recovery tag created before each manual history migration.

## Patch stack rules

- No merge commits above the upstream base.
- Each commit contains one downstream topic.
- The Claude fix keeps the stable patch ID recorded in `config/horca/patch-stack.json` until upstream has an equivalent fix.
- New Horca code goes in a fork-owned path first.
- Generic fixes and extension points go to upstream from a branch based on `upstream/main`.
- Release tags are immutable even though automation rebases `main`.

`config/horca/scripts/check-patch-stack.mjs` enforces the history shape and required carried patches.

## Overlay ownership

Prefer these fork-owned paths:

- `src/main/horca/`
- `src/shared/horca/`
- `src/main/providers/multiplexer/herdr/`
- `src/renderer/src/horca/`
- `config/horca/`
- `resources/horca/`
- `docs/horca/`
- `.github/workflows/horca_*`

`config/horca/overlay-policy.json` records every modified upstream file, its reason, and its removal condition. CI rejects deleted upstream files, workflow overlays, locale overlays, E2E overlays, stale ledger entries, unowned changes, and Herdr imports outside fork-owned paths. The report shows files, lines, and hunks so maintainers can reduce the conflict surface without using an arbitrary file-count gate.

`src/main/index.ts` and `src/main/updater.ts` stay byte-identical to upstream. They are thin composers after Orca's startup and updater splits. CI denies overlays of those two paths. Horca startup hooks live here:

- `src/main/startup/main-process-preflight.ts`: `configureHorcaUserDataPath` before the userData decision, `assertHorcaPackagedDistribution` after the lock
- `src/main/startup/main-process-ready-foundation.ts`: `initializeHorca(store)` after Store construction
- `src/main/updater/updater-setup.ts`: in-app updater gate for downstream releases

## Workflow ownership

Upstream workflow files stay byte-identical. The hourly maintenance job enables only the files in `config/horca/enabled-workflows.txt` and disables every other workflow through GitHub repository state. This also disables new upstream workflows without adding a downstream Git change.

## Upstream contribution example

```bash
git fetch upstream
git switch -c fix/example upstream/main
```

Rebase and update the contribution branch against `upstream/main`. Do not rebase it onto Horca `main`.
