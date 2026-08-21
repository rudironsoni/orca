import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HerdrSocketSessionManager } from './herdr-socket-session'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

type MockChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

function createChild(): MockChild {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn()
  })
}

function run(manager: HerdrSocketSessionManager): (args: string[]) => Promise<string> {
  return (manager as unknown as { run(args: string[]): Promise<string> }).run.bind(manager)
}

beforeEach(() => {
  spawnMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('HerdrSocketSessionManager command execution', () => {
  it('drains stderr and includes it in nonzero-exit failures', async () => {
    const child = createChild()
    spawnMock.mockReturnValue(child)
    const manager = new HerdrSocketSessionManager({
      sessionName: 'test',
      commandFor: (args) => ({ file: 'herdr', args })
    })
    const pending = run(manager)(['session', 'list'])

    child.stderr.emit('data', Buffer.from('specific failure'))
    child.emit('close', 2, null)

    await expect(pending).rejects.toThrow('specific failure')
  })

  it('kills and rejects a command that exceeds its timeout', async () => {
    vi.useFakeTimers()
    const child = createChild()
    spawnMock.mockReturnValue(child)
    const manager = new HerdrSocketSessionManager({
      sessionName: 'test',
      timeoutMs: 25,
      commandFor: (args) => ({ file: 'herdr', args })
    })
    const pending = run(manager)(['session', 'list'])
    const rejection = expect(pending).rejects.toThrow('timed out')

    await vi.advanceTimersByTimeAsync(25)

    await rejection
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it.each(['stdout', 'stderr'] as const)('rejects when %s emits an error', async (pipe) => {
    const child = createChild()
    spawnMock.mockReturnValue(child)
    const manager = new HerdrSocketSessionManager({
      sessionName: 'test',
      commandFor: (args) => ({ file: 'herdr', args })
    })
    const pending = run(manager)(['session', 'list'])

    child[pipe].emit('error', new Error(`${pipe} failed`))

    await expect(pending).rejects.toThrow(`${pipe} failed`)
  })
})
