'use strict'

// Keep in lockstep with horca-vite-distribution.ts. Node scripts require this
// file; tsc forbids import.meta in the TypeScript copy (CJS emit).

const { homedir } = require('node:os')
const { join } = require('node:path')

const HORCA_DEV_USER_DATA_DIR = '.horca-dev'

function applyHorcaViteDistributionEnv(env) {
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

module.exports = { applyHorcaViteDistributionEnv, HORCA_DEV_USER_DATA_DIR }
