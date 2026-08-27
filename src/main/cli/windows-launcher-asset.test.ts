import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('packaged Windows CLI launcher asset', () => {
  it('keeps the batch compatibility shim behind the newline-safe native launcher', () => {
    const launcherPath = join(process.cwd(), 'resources', 'win32', 'bin', 'orca.cmd')
    const launcher = readFileSync(launcherPath, 'utf8')

    // Why %~n0: the shim ships under each distribution's CLI name and must
    // resolve the native launcher from its own basename.
    expect(launcher).toContain('set "LAUNCHER=%SCRIPT_DIR%%~n0.exe"')
    expect(launcher).toContain('orca.cmd cannot safely forward orchestration message bodies')
    expect(launcher).not.toContain('"%ELECTRON%" "%CLI%" %*')
  })

  it('marks the packaged child and propagates its exact exit status', () => {
    const sourcePath = join(process.cwd(), 'native', 'windows-cli-launcher', 'OrcaCliLauncher.cs')
    const source = readFileSync(sourcePath, 'utf8')

    // Why: the marker and command name must ride the launcher's own environment, never
    // ProcessStartInfo's case-insensitive copy of a PATH/Path block (stablyai/orca#12046).
    expect(source).toContain(
      'Environment.SetEnvironmentVariable("ORCA_WINDOWS_PACKAGED_CLI_LAUNCHER", "1");'
    )
    expect(source).toContain(
      'string requestedCliCommand = Environment.GetEnvironmentVariable("ORCA_CLI_COMMAND");'
    )
    expect(source).toContain('requestedCliCommand == "orca-ide" ? "orca-ide" : "orca"')
    // Why: downstream distributions rename the launcher, which must then find
    // its own distribution's app executable rather than a hardcoded Orca.exe.
    expect(source).toContain(
      'string launcherBaseName = Path.GetFileNameWithoutExtension(launcherPath);'
    )
    expect(source).toContain('child.WaitForExit();')
    expect(source).toContain('return child.ExitCode;')
  })
})
