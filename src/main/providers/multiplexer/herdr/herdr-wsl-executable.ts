import { execFileSync } from 'node:child_process'
import {
  buildWslCapturedLoginShellCommand,
  buildWslExecArgs
} from '../../../../shared/wsl-login-shell-command'
import { HerdrRuntimeError } from './herdr-runtime-contract'
import type { HerdrBinarySource } from '../../../../shared/terminal-backend'

const resolvedByDistro = new Map<string, string>()

export type WslHerdrPathProbe = (distro: string) => string

export function clearWslHerdrExecutableCache(): void {
  resolvedByDistro.clear()
}

export function resolveWslHerdrExecutable(
  distro: string,
  source: HerdrBinarySource,
  probe: WslHerdrPathProbe = probeWslHerdrPath
): string {
  if (source.kind === 'custom') {
    const customPath = source.path.trim()
    if (!customPath.startsWith('/')) {
      throw new HerdrRuntimeError(
        'herdr_unavailable',
        `WSL Herdr path must be an absolute guest path: ${customPath || '(empty)'}`
      )
    }
    return customPath
  }
  const cached = resolvedByDistro.get(distro)
  if (cached) {
    return cached
  }
  const resolved = probe(distro)
  resolvedByDistro.set(distro, resolved)
  return resolved
}

function probeWslHerdrPath(distro: string): string {
  const captured = buildWslCapturedLoginShellCommand(
    [
      '_orca_herdr_path=$(command -v herdr 2>/dev/null || true)',
      'case "$_orca_herdr_path" in /*) [ -x "$_orca_herdr_path" ] || exit 127 ;; *) exit 127 ;; esac',
      'printf %s "$_orca_herdr_path"'
    ].join('\n')
  )
  try {
    const stdout = execFileSync(
      'wsl.exe',
      buildWslExecArgs(distro, ['sh', '-lc', captured.command]),
      { encoding: 'utf8', timeout: 10_000, windowsHide: true, maxBuffer: 64 * 1024 }
    )
    const path = captured.readStdout(stdout)?.trim() ?? ''
    if (!path.startsWith('/') || path.includes('\n') || path.includes('\r')) {
      throw new Error('invalid')
    }
    return path
  } catch {
    throw new HerdrRuntimeError(
      'herdr_unavailable',
      `Herdr is not on the WSL login PATH for distro ${distro}`
    )
  }
}
