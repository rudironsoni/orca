import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REQUIRED_HERDR_METHODS } from '../../providers/multiplexer/herdr/herdr-runtime-contract'
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
        stdout: JSON.stringify({
          protocol: 20,
          schema_version: 1,
          schemas: {
            request: {
              oneOf: REQUIRED_HERDR_METHODS.map((method) => ({
                properties: { method: { const: method } }
              }))
            }
          }
        }),
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
        stdout: JSON.stringify({ protocol: 19, schema_version: 1, schemas: {} }),
        stderr: ''
      })

    await expect(readLocalHerdrHealth(settings)).resolves.toMatchObject({
      status: 'unavailable',
      error: expect.stringContaining('protocol 20 or newer')
    })
  })
})
