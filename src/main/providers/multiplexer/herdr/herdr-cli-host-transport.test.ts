import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localHerdrCommand } from './herdr-cli-session'
import { HerdrSdkHost } from './herdr-sdk-host'
import type { HerdrSdkRuntime } from './herdr-sdk-runtime'

const { spawnProcessMock } = vi.hoisted(() => ({
  spawnProcessMock: vi.fn()
}))
vi.mock('../../../../shared/child-process/run-process', () => ({
  runProcess: vi.fn(),
  spawnProcess: spawnProcessMock
}))

beforeEach(() => {
  spawnProcessMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

type MockChild = EventEmitter & {
  stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> }
  stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> }
  kill: ReturnType<typeof vi.fn>
}

function createChild(): MockChild {
  const child = Object.assign(new EventEmitter(), {
    stdin: Object.assign(new EventEmitter(), {
      writable: true,
      write: vi.fn(() => true),
      end: vi.fn()
    }),
    stdout: Object.assign(new EventEmitter(), {
      setEncoding: vi.fn()
    }),
    stderr: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    kill: vi.fn()
  })
  return child as unknown as MockChild
}

function loadTransport() {
  const sdk = {
    run: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    ping: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined)
  } as unknown as HerdrSdkRuntime
  return new HerdrSdkHost({
    sdk,
    commandFor: localHerdrCommand('/mock/herdr')
  })
}

describe('HerdrSdkHost terminal control', () => {
  it('streams terminal frames and buffers them until subscribed', async () => {
    const transport = loadTransport()
    const child = createChild()
    spawnProcessMock.mockReturnValue(child)

    const controller = transport.controlTerminal('ws', 'w1:p1', { cols: 80, rows: 24 })
    const frames: { seq: number }[] = []
    controller.onFrame((frame) => frames.push(frame as { seq: number }))
    child.stdout.emit('data', `${JSON.stringify({ type: 'terminal.frame', seq: 1, bytes: 'x' })}\n`)
    child.stdout.emit('data', `${JSON.stringify({ type: 'terminal.frame', seq: 2, bytes: 'y' })}\n`)
    expect(frames.map((f) => f.seq)).toEqual([1, 2])
  })

  it('emits closed on a terminal.closed frame', async () => {
    const transport = loadTransport()
    const child = createChild()
    spawnProcessMock.mockReturnValue(child)

    const controller = transport.controlTerminal('ws', 'w1:p1', { cols: 80, rows: 24 })
    const closed: unknown[] = []
    controller.onClosed((event) => closed.push(event))
    child.stdout.emit('data', `${JSON.stringify({ type: 'terminal.closed', reason: 'gone' })}\n`)
    expect(closed).toEqual([{ type: 'terminal.closed', reason: 'gone' }])
  })

  it('sends input, resize, and release over stdin', async () => {
    const transport = loadTransport()
    const child = createChild()
    spawnProcessMock.mockReturnValue(child)

    const controller = transport.controlTerminal('ws', 'w1:p1', { cols: 80, rows: 24 })
    controller.write('hello')
    controller.resize(120, 40)
    controller.release()

    const writes = child.stdin.write.mock.calls.map((c) => c[0] as string)
    expect(writes).toEqual([
      '{"type":"terminal.input","text":"hello"}\n',
      '{"type":"terminal.resize","cols":120,"rows":40}\n',
      '{"type":"terminal.release"}\n'
    ])
    expect(child.stdin.end).toHaveBeenCalled()
  })

  it('emits closed when the child exits without releasing', async () => {
    const transport = loadTransport()
    const child = createChild()
    spawnProcessMock.mockReturnValue(child)

    const controller = transport.controlTerminal('ws', 'w1:p1', { cols: 80, rows: 24 })
    const closed: { reason: string }[] = []
    controller.onClosed((event) => closed.push(event))
    child.emit('close', 1)
    expect(closed.length).toBe(1)
  })
})
