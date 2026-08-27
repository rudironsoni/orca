import { runWslProcess } from '../../../wsl/wsl-runner'
import { HerdrRuntimeError } from './herdr-runtime-contract'
import type { HerdrBinarySource } from '../../../../shared/horca/terminal-backend'

const resolvedByDistro = new Map<string, string>()

export type WslHerdrPathProbe = (distro: string) => string | Promise<string>

export function clearWslHerdrExecutableCache(): void {
  resolvedByDistro.clear()
}

export async function resolveWslHerdrExecutable(
  distro: string,
  source: HerdrBinarySource,
  probe: WslHerdrPathProbe = probeWslHerdrPath
): Promise<string> {
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
  const resolved = await probe(distro)
  resolvedByDistro.set(distro, resolved)
  return resolved
}

async function probeWslHerdrPath(distro: string): Promise<string> {
  try {
    const result = await runWslProcess({
      loginPath: 'preferred',
      distro,
      script: [
        '_orca_herdr_path=$(command -v herdr 2>/dev/null || true)',
        'case "$_orca_herdr_path" in /*) [ -x "$_orca_herdr_path" ] || exit 127 ;; *) exit 127 ;; esac',
        'printf %s "$_orca_herdr_path"'
      ].join('\n'),
      timeoutMs: 10_000,
      maxOutputBytes: 64 * 1024
    })
    if (!result.environmentResolved) {
      throw new HerdrRuntimeError(
        'herdr_unavailable',
        `WSL login PATH is unverifiable for distro ${distro}`
      )
    }
    const path = result.stdout.trim()
    if (
      result.timedOut ||
      result.code !== 0 ||
      !path.startsWith('/') ||
      path.includes('\n') ||
      path.includes('\r')
    ) {
      throw new Error('invalid')
    }
    return path
  } catch (error) {
    if (error instanceof HerdrRuntimeError) {
      throw error
    }
    throw new HerdrRuntimeError(
      'herdr_unavailable',
      `Herdr is not on the WSL login PATH for distro ${distro}`
    )
  }
}
