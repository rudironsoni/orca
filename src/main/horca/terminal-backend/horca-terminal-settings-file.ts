import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ExecutionHostId } from '../../../shared/execution-host'

export type HorcaSettingsFile = {
  version?: unknown
  terminalBackendDefault?: unknown
  floatingTerminalPreference?: unknown
  herdr?: {
    binarySource?: unknown
    defaultSessionName?: unknown
    hostBinarySources?: Partial<Record<ExecutionHostId, unknown>>
  }
  projects?: Record<
    string,
    {
      preference?: unknown
      sessionName?: unknown
      activations?: Partial<Record<ExecutionHostId, unknown>>
    }
  >
}

export function readHorcaTerminalSettingsFile(path: string | undefined): HorcaSettingsFile | null {
  if (!path) {
    return null
  }
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return value && typeof value === 'object' ? (value as HorcaSettingsFile) : null
  } catch {
    return null
  }
}

export function writeHorcaTerminalSettingsFile(path: string, settings: HorcaSettingsFile): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify({ ...settings, version: 2 }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  renameSync(temporary, path)
}
