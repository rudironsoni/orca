import { homedir } from 'node:os'
import { join } from 'node:path'

export const HORCA_DEV_USER_DATA_DIR = '.horca-dev'

/**
 * Horca wrap for electron-vite, same idea as electron-builder-downstream.cjs.
 *
 * electron.vite.config.ts keeps the upstream ternary
 * (`ORCA_DOWNSTREAM_BUILD === '1' ? 'horca' : 'official'`). This module
 * fills the flag when it is unset so `pnpm build` / `pnpm dev` compile
 * ~/.horca without inverting that ternary. Explicit `=0` stays official.
 *
 * Dev userData follows the same wrap: upstream still hardcodes `orca-dev`
 * under appData. When this fork compiles Horca, an unset
 * ORCA_DEV_USER_DATA_PATH becomes ~/.horca-dev so the Electron profile does
 * not land in Application Support/orca-dev.
 *
 * Keep `horca-vite-distribution.cjs` in lockstep: Node scripts require the
 * CJS copy because they cannot import this TypeScript file.
 */
export function applyHorcaViteDistributionEnv(env: NodeJS.ProcessEnv): void {
  if (env.ORCA_DOWNSTREAM_BUILD === undefined) {
    env.ORCA_DOWNSTREAM_BUILD = '1'
  }
  if (env.ORCA_DOWNSTREAM_BUILD === '0' || env.ORCA_DEV_USER_DATA_PATH) {
    return
  }
  env.ORCA_DEV_USER_DATA_PATH = join(
    env.HOME ?? env.USERPROFILE ?? homedir(),
    HORCA_DEV_USER_DATA_DIR
  )
}
