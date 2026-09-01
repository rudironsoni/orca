import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HERDR_PROTOCOL_VERSION } from '../../providers/multiplexer/herdr/herdr-runtime-contract'
import { readLocalHerdrHealth } from './horca-herdr-health'
import type { HorcaTerminalSettingsSource } from './horca-terminal-settings'

const { runProcessMock } = vi.hoisted(() => ({ runProcessMock: vi.fn() }))
vi.mock('../../../shared/child-process/run-process', () => ({ runProcess: runProcessMock }))
vi.mock('../../providers/multiplexer/herdr/herdr-provider-factory', () => ({
  resolveHerdrExecutable: () => '/app/resources/herdr/herdr'
}))

const settings = {
  getHerdrSettings: () => ({ binarySource: { kind: 'managed' } })
} as unknown as HorcaTerminalSettingsSource

beforeEach(() => {
  runProcessMock.mockReset()
})

describe('local Herdr health', () => {
  it('verifies the executable version and required API surface', async () => {
    runProcessMock
      .mockResolvedValueOnce({ code: 0, timedOut: false, stdout: 'herdr 0.8.2\n', stderr: '' })
      .mockResolvedValueOnce({
        code: 0,
        timedOut: false,
        stdout: JSON.stringify({ protocol: HERDR_PROTOCOL_VERSION, schema_version: 1 }),
        stderr: ''
      })

    await expect(readLocalHerdrHealth(settings)).resolves.toMatchObject({
      status: 'ready',
      executable: '/app/resources/herdr/herdr',
      version: '0.8.2'
    })
  })

  it('reports an incompatible API as unavailable', async () => {
    runProcessMock
      .mockResolvedValueOnce({ code: 0, timedOut: false, stdout: 'herdr 0.7.0\n', stderr: '' })
      .mockResolvedValueOnce({
        code: 0,
        timedOut: false,
        stdout: JSON.stringify({ protocol: HERDR_PROTOCOL_VERSION - 1, schema_version: 1 }),
        stderr: ''
      })

    await expect(readLocalHerdrHealth(settings)).resolves.toMatchObject({
      status: 'unavailable',
      error: expect.stringContaining(`incompatible with ${HERDR_PROTOCOL_VERSION}`)
    })
  })
})
