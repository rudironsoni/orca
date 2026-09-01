import { runProcess } from '../../../shared/child-process/run-process'
import type { HorcaHerdrHealth } from '../../../shared/horca/terminal-settings-api'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import { resolveHerdrExecutable } from '../../providers/multiplexer/herdr/herdr-provider-factory'
import {
  HERDR_SUPPORTED_PROTOCOLS,
  isSupportedHerdrProtocol
} from '../../providers/multiplexer/herdr/herdr-runtime-contract'
import type { HorcaTerminalSettingsSource } from './horca-terminal-settings'

export async function readLocalHerdrHealth(
  settings: HorcaTerminalSettingsSource
): Promise<HorcaHerdrHealth> {
  const source = settings.getHerdrSettings(LOCAL_EXECUTION_HOST_ID).binarySource
  try {
    const executable = resolveHerdrExecutable(source)
    const result = await runProcess({
      program: executable,
      args: ['--version'],
      timeoutMs: 5_000,
      maxOutputBytes: 16 * 1024
    })
    const version = result.stdout.trim().replace(/^herdr\s+/i, '')
    if (result.code !== 0 || result.timedOut || !version) {
      throw new Error(result.stderr.trim() || 'Herdr did not report its version')
    }
    const schemaResult = await runProcess({
      program: executable,
      args: ['api', 'schema', '--json'],
      timeoutMs: 5_000,
      maxOutputBytes: 2 * 1024 * 1024
    })
    if (schemaResult.code !== 0 || schemaResult.timedOut) {
      throw new Error(schemaResult.stderr.trim() || 'Herdr did not report its API schema')
    }
    const schema = JSON.parse(schemaResult.stdout) as { protocol?: unknown }
    if (typeof schema.protocol !== 'number' || !isSupportedHerdrProtocol(schema.protocol)) {
      throw new Error(
        `Herdr protocol ${String(schema.protocol)} is incompatible with ${HERDR_SUPPORTED_PROTOCOLS.join(', ')}`
      )
    }
    return { status: 'ready', source, executable, version }
  } catch (error) {
    return {
      status: 'unavailable',
      source,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
