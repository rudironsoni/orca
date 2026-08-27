import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { SshTarget } from '../../../../shared/ssh-types'
import { herdrServerEnvironment } from './herdr-cli-session'
import {
  buildSshArgs,
  findSystemSsh,
  getOrcaControlSocketPath
} from '../../../ssh/ssh-system-fallback'
import type { SystemSshResolvedConfig } from '../../../ssh/ssh-control-socket'
import { isOpenSshConfigBackedTarget } from '../../../ssh/system-ssh-args'

export type HerdrRemoteSshLaunch = {
  dest: string
  env: { HERDR_CONFIG_PATH: string; PATH: string }
  joinControlPath: string | null
  sshArgs: string[]
  sshBinary: string
  cleanup: () => void
}

export function herdrRemoteDest(target: SshTarget): string {
  if (isOpenSshConfigBackedTarget(target) && target.configHost) {
    return target.configHost
  }
  const host = target.configHost || target.host
  return target.username ? `${target.username}@${host}` : host
}

export function herdrRemoteSshArgs(
  target: SshTarget,
  resolvedConfig?: Partial<SystemSshResolvedConfig> | null
): { dest: string; joinControlPath: string | null; sshArgs: string[] } {
  const dest = herdrRemoteDest(target)
  const controlPath = getOrcaControlSocketPath(target, {
    resolvedConfig: resolvedConfig as SystemSshResolvedConfig | null | undefined
  })
  const built = buildSshArgs(target, {
    resolvedConfig: resolvedConfig as SystemSshResolvedConfig | null | undefined
  })
  const destIndex = built.lastIndexOf('--')
  const prefix = destIndex === -1 ? built : built.slice(0, destIndex)
  const sshArgs = rewriteSshArgsForHerdrRemote(prefix, controlPath)
  return { dest, joinControlPath: controlPath, sshArgs }
}

function rewriteSshArgsForHerdrRemote(args: string[], controlPath: string | null): string[] {
  const next: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const value = args[index + 1]
    if (arg === '-o' && value === 'ControlMaster=auto') {
      next.push('-o', controlPath ? 'ControlMaster=no' : 'ControlMaster=auto')
      index += 1
      continue
    }
    if (arg === '-o' && value?.startsWith('ControlPersist=')) {
      index += 1
      continue
    }
    next.push(arg)
  }
  return next
}

export function writeHerdrRemoteSshLaunch(args: {
  target: SshTarget
  resolvedConfig?: Partial<SystemSshResolvedConfig> | null
  sshBinary?: string
}): HerdrRemoteSshLaunch {
  const sshBinary = args.sshBinary ?? findSystemSsh()
  if (!sshBinary) {
    throw new Error('System ssh is not available for herdr --remote')
  }
  const { dest, joinControlPath, sshArgs } = herdrRemoteSshArgs(args.target, args.resolvedConfig)
  const root = join(tmpdir(), `orca-herdr-remote-${process.getuid?.() ?? 'user'}`)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  assertOwnedLaunchRoot(root)
  const dir = mkdtempSync(join(root, `${sanitizeDirName(args.target.id || dest)}-`))
  chmodSync(dir, 0o700)
  writeFileSync(join(dir, 'config.toml'), '[remote]\nmanage_ssh_config = false\n', { mode: 0o600 })
  writeSshShim(dir, sshBinary, sshArgs)
  return {
    dest,
    env: {
      HERDR_CONFIG_PATH: join(dir, 'config.toml'),
      PATH: `${dir}${delimiter}${process.env.PATH ?? ''}`
    },
    joinControlPath,
    sshArgs,
    sshBinary,
    cleanup: createRetryingCleanup(() => {
      rmSync(dir, { recursive: true, force: true })
    })
  }
}

export function createRetryingCleanup(remove: () => void): () => void {
  let cleaned = false
  return () => {
    if (cleaned) {
      return
    }
    removeWithRetry(remove)
    cleaned = true
  }
}

function removeWithRetry(remove: () => void): void {
  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      remove()
      return
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error
      }
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EBUSY') {
        waitMs(25 * attempt)
      }
    }
  }
}

function waitMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function sanitizeDirName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'host'
}

export function herdrRemoteCommandEnv(
  launch: HerdrRemoteSshLaunch,
  extra?: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  return {
    ...herdrServerEnvironment(extra),
    PATH: launch.env.PATH,
    HERDR_CONFIG_PATH: launch.env.HERDR_CONFIG_PATH
  }
}

function assertOwnedLaunchRoot(root: string): void {
  if (process.platform === 'win32') {
    return
  }
  const stats = lstatSync(root)
  const uid = process.getuid?.()
  if (!stats.isDirectory() || (uid !== undefined && stats.uid !== uid)) {
    throw new Error(`Unsafe herdr remote launch directory ${root}`)
  }
  if ((stats.mode & 0o077) !== 0) {
    chmodSync(root, 0o700)
    if ((lstatSync(root).mode & 0o077) !== 0) {
      throw new Error(`Unsafe herdr remote launch directory ${root}`)
    }
  }
}

function writeSshShim(dir: string, sshBinary: string, sshArgs: string[]): void {
  if (process.platform === 'win32') {
    writeFileSync(join(dir, 'ssh.cmd'), herdrWindowsSshShim(sshBinary, sshArgs), { mode: 0o700 })
    return
  }
  const quoted = [sshBinary, ...sshArgs].map(posixShellQuote).join(' ')
  writeFileSync(join(dir, 'ssh'), `#!/bin/sh\nexec ${quoted} "$@"\n`, { mode: 0o700 })
}

export function herdrWindowsSshShim(sshBinary: string, sshArgs: string[]): string {
  const lines = [
    '@echo off',
    `set "ORCA_HERDR_SSH=${escapeCmdValue(sshBinary)}"`,
    `"%ORCA_HERDR_SSH%" ${sshArgs.map(quoteCmdArgument).join(' ')} %*`
  ]
  return `${lines.join('\r\n')}\r\n`
}

function posixShellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function escapeCmdValue(value: string): string {
  return value.replaceAll('%', '%%').replaceAll('"', '""')
}

function quoteCmdArgument(value: string): string {
  return `"${escapeCmdValue(value)}"`
}
