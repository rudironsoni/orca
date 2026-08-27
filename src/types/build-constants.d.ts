// Ambient declarations for compile-time constants substituted by the build
// configs. The telemetry constants live in electron-vite's main `define`
// block; contributor / `pnpm dev` / third-party builds substitute literal
// `null`, which `IS_OFFICIAL_BUILD` in `src/main/telemetry/client.ts`
// evaluates to `false` at module load — such builds console-mirror only.
//
// The CI release workflow (and only the CI release workflow) provides real
// values via GitHub Actions secrets. There is no runtime env-var fallback;
// the substitution happens at compile time so a curious contributor cannot
// spoof transmission with a shell export.
//
declare const ORCA_BUILD_IDENTITY: 'stable' | 'rc' | null
declare const ORCA_POSTHOG_WRITE_KEY: string | null

// Which distribution this build ships as (src/shared/distribution-identity.ts).
// 'horca' only when the fork's downstream packaging sets
// ORCA_DOWNSTREAM_BUILD=1 at build time; every other build path — official CI,
// contributor builds, `pnpm dev` — substitutes 'official'. Vitest skips the
// define pass; the runtime accessor falls back to a globalThis override, then
// 'official'.
declare const ORCA_DISTRIBUTION: 'official' | 'horca'

// Diagnostic-bundle upload endpoint for Mode 3 (telemetry-error-tracking.md
// §Endpoint contract). Substituted by CI; `null` in contributor builds, at
// which point the upload IPC handler returns "endpoint not configured"
// rather than POSTing to a placeholder. The dev escape hatch is the
// `ORCA_DIAGNOSTICS_TOKEN_URL` env var, which env wins so a developer can
// point a packaged build at a staging server without re-running the
// release pipeline.
declare const ORCA_DIAGNOSTICS_TOKEN_URL: string | null
