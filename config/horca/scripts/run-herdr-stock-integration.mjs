#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const scriptDir = import.meta.dirname
const repoRoot = join(scriptDir, '..', '..', '..')

function resolveHerdrBinary() {
  if (process.env.ORCA_HERDR_TEST_BINARY) {
    return process.env.ORCA_HERDR_TEST_BINARY
  }
  return execFileSync(process.execPath, [join(scriptDir, 'download-herdr-release.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8'
  }).trim()
}

execFileSync(
  process.execPath,
  [
    join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    '--config',
    'config/vitest.config.ts',
    'src/main/providers/multiplexer/herdr/herdr-real-runtime.integration.test.ts',
    'src/main/providers/multiplexer/herdr/herdr-process-restart.integration.test.ts'
  ],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ORCA_HERDR_TEST_BINARY: resolveHerdrBinary() }
  }
)
