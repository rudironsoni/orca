import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HerdrSocketSessionManager } from './herdr-socket-session'

const { runProcessMock } = vi.hoisted(() => ({ runProcessMock: vi.fn() }))
vi.mock('../../../../shared/child-process/run-process', () => ({
  runProcess: runProcessMock,
  spawnProcess: vi.fn()
}))

function run(manager: HerdrSocketSessionManager): (args: string[]) => Promise<string> {
  return (manager as unknown as { run(args: string[]): Promise<string> }).run.bind(manager)
}

beforeEach(() => {
  runProcessMock.mockReset()
})

describe('HerdrSocketSessionManager command execution', () => {
  it('drains stderr and includes it in nonzero-exit failures', async () => {
    runProcessMock.mockResolvedValue({
      code: 2,
      signal: null,
      stdout: '',
      stderr: 'specific failure',
      timedOut: false
    })
    const manager = new HerdrSocketSessionManager({
      sessionName: 'test',
      commandFor: (args) => ({ file: 'herdr', args })
    })
    await expect(run(manager)(['session', 'list'])).rejects.toThrow('specific failure')
  })

  it('rejects a command that exceeds its timeout', async () => {
    runProcessMock.mockResolvedValue({
      code: null,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: true
    })
    const manager = new HerdrSocketSessionManager({
      sessionName: 'test',
      timeoutMs: 25,
      commandFor: (args) => ({ file: 'herdr', args })
    })
    await expect(run(manager)(['session', 'list'])).rejects.toThrow('timed out')
    expect(runProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({ program: 'herdr', args: ['session', 'list'], timeoutMs: 25 })
    )
  })

  it('includes the signal when the child exits without a code', async () => {
    runProcessMock.mockResolvedValue({
      code: null,
      signal: 'SIGTERM',
      stdout: '',
      stderr: '',
      timedOut: false
    })
    const manager = new HerdrSocketSessionManager({
      sessionName: 'test',
      commandFor: (args) => ({ file: 'herdr', args })
    })
    await expect(run(manager)(['session', 'list'])).rejects.toThrow('signal SIGTERM')
  })
})
