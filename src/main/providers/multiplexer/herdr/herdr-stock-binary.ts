import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcessSync } from '../../../../shared/child-process/run-process'

/** Resolve a stock herdr binary for live tests: explicit env, then PATH. */
export function resolveStockHerdrTestBinary(): string | null {
  const explicit = process.env.ORCA_HERDR_TEST_BINARY?.trim()
  if (explicit && existsSync(explicit)) {
    return explicit
  }
  try {
    const result = runProcessSync({
      program: process.platform === 'win32' ? 'where' : 'which',
      args: ['herdr'],
      timeoutMs: 5_000
    })
    const found = result.stdout.trim().split(/\r?\n/)[0]
    return result.code === 0 && found && existsSync(found) ? found : null
  } catch {
    return null
  }
}

const SOCKET_PATH_LIMIT = 104

/** Scratch HOME plus pinned XDG_CONFIG_HOME so stock herdr and Orca share one socket path. */
export function isolatedStockHerdrHomeEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, '.config')
  }
  for (const name of Object.keys(env)) {
    if (name.startsWith('HERDR_')) {
      delete env[name]
    }
  }
  return env
}

export function configHomeDir(): string {
  const roots = process.platform === 'win32' ? [tmpdir()] : [tmpdir(), '/tmp']
  for (const root of new Set(roots)) {
    let candidate: string
    try {
      candidate = mkdtempSync(join(root, 'orca-h-'))
    } catch {
      continue
    }
    if (
      candidate.length + '/.config/herdr/sessions/ot-123456/herdr.sock'.length <=
      SOCKET_PATH_LIMIT
    ) {
      return candidate
    }
    rmSync(candidate, { recursive: true, force: true })
  }
  throw new Error('No writable temp dir yields a short enough herdr socket path')
}
