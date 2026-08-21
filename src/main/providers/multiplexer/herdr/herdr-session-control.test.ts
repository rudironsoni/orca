import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { herdrSessionControlArgs, type HerdrSessionControlStream } from './herdr-session-control'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

beforeEach(() => {
  spawnMock.mockReset()
})

type MockChild = EventEmitter & {
  stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> }
  stderr: EventEmitter
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
    stderr: Object.assign(new EventEmitter(), {
      setEncoding: vi.fn()
    }),
    kill: vi.fn()
  })
  return child as unknown as MockChild
}

describe('herdrSessionControlArgs', () => {
  it('builds a control attach without takeover', () => {
    expect(herdrSessionControlArgs('orca', 'w1:p1', { cols: 80, rows: 24 })).toEqual([
      '--session',
      'orca',
      'terminal',
      'session',
      'control',
      'w1:p1',
      '--cols',
      '80',
      '--rows',
      '24'
    ])
  })

  it('builds an observe attach so a Herdr TUI can keep exclusive control', () => {
    expect(
      herdrSessionControlArgs('orca', 'w1:p1', {
        cols: 80,
        rows: 24,
        observe: true,
        takeover: true
      })
    ).toEqual([
      '--session',
      'orca',
      'terminal',
      'session',
      'observe',
      'w1:p1',
      '--cols',
      '80',
      '--rows',
      '24'
    ])
  })
})

describe('createHerdrSessionControlController', () => {
  it('sends input, resize, and release over stdin', async () => {
    const child = createChild()
    spawnMock.mockReturnValue(child)
    const { createHerdrSessionControlController } = await import('./herdr-session-control')
    const controller = createHerdrSessionControlController({
      file: '/mock/herdr',
      args: herdrSessionControlArgs('orca', 'w1:p1', { cols: 80, rows: 24 })
    })
    controller.write('\u001b\u007f')
    controller.resize(120, 40)
    controller.release()

    expect(spawnMock).toHaveBeenCalledWith(
      '/mock/herdr',
      herdrSessionControlArgs('orca', 'w1:p1', { cols: 80, rows: 24 }),
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] })
    )
    expect(child.stdin.write.mock.calls.map((call) => call[0])).toEqual([
      `${JSON.stringify({ type: 'terminal.input', text: '\u001b\u007f' })}\n`,
      `${JSON.stringify({ type: 'terminal.resize', cols: 120, rows: 40 })}\n`,
      `${JSON.stringify({ type: 'terminal.release' })}\n`
    ])
  })

  it.each(['stdin', 'stdout'] as const)('closes cleanly when %s emits an error', async (pipe) => {
    const child = createChild()
    spawnMock.mockReturnValue(child)
    const { createHerdrSessionControlController } = await import('./herdr-session-control')
    const controller = createHerdrSessionControlController({
      file: '/mock/herdr',
      args: []
    })
    const closed = vi.fn()
    controller.onClosed(closed)

    child[pipe].emit('error', new Error(`${pipe} failed`))

    expect(closed).toHaveBeenCalledWith({
      type: 'terminal.closed',
      reason: `${pipe} failed`
    })
  })
})

describe('createHerdrSessionControlFromOpen', () => {
  it('queues writes until the stream opens', async () => {
    const { createHerdrSessionControlFromOpen } = await import('./herdr-session-control')
    let resolveOpen: ((stream: HerdrSessionControlStream) => void) | undefined
    const write = vi.fn<(data: string) => void>()
    const controller = createHerdrSessionControlFromOpen(
      () =>
        new Promise((resolve) => {
          resolveOpen = resolve
        })
    )
    controller.write('hello')
    controller.resize(80, 24)
    expect(write).not.toHaveBeenCalled()
    resolveOpen?.({
      writable: true,
      write,
      end: vi.fn(),
      close: vi.fn(),
      onData: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn()
    })
    await Promise.resolve()
    expect(write.mock.calls.map((call) => call[0])).toEqual([
      `${JSON.stringify({ type: 'terminal.input', text: 'hello' })}\n`,
      `${JSON.stringify({ type: 'terminal.resize', cols: 80, rows: 24 })}\n`
    ])
    controller.release()
  })

  it('retains every frame emitted before a listener is attached', async () => {
    const { createHerdrSessionControlFromOpen } = await import('./herdr-session-control')
    let emitData: ((chunk: string) => void) | undefined
    const controller = createHerdrSessionControlFromOpen(async () => ({
      writable: true,
      write: vi.fn(),
      end: vi.fn(),
      close: vi.fn(),
      onData: (listener) => {
        emitData = listener
      },
      onError: vi.fn(),
      onClose: vi.fn()
    }))
    await Promise.resolve()

    for (let seq = 0; seq < 513; seq += 1) {
      emitData?.(
        `${JSON.stringify({
          type: 'terminal.frame',
          seq,
          encoding: 'ansi',
          width: 80,
          height: 24,
          full: false,
          bytes: ''
        })}\n`
      )
    }
    const frames: number[] = []
    controller.onFrame((frame) => frames.push(frame.seq))
    expect(frames).toEqual(Array.from({ length: 512 }, (_, index) => index + 1))
    controller.release()
  })

  it('keeps the latest full frame when pending frames overflow', async () => {
    const { createHerdrSessionControlFromOpen } = await import('./herdr-session-control')
    let emitData: ((chunk: string) => void) | undefined
    const controller = createHerdrSessionControlFromOpen(async () => ({
      writable: true,
      write: vi.fn(),
      end: vi.fn(),
      close: vi.fn(),
      onData: (listener) => {
        emitData = listener
      },
      onError: vi.fn(),
      onClose: vi.fn()
    }))
    await Promise.resolve()

    const send = (seq: number, full: boolean): void => {
      emitData?.(
        `${JSON.stringify({
          type: 'terminal.frame',
          seq,
          encoding: 'ansi',
          width: 80,
          height: 24,
          full,
          bytes: ''
        })}\n`
      )
    }
    send(0, false)
    send(1, true)
    for (let seq = 2; seq < 514; seq += 1) {
      send(seq, false)
    }
    const frames: number[] = []
    controller.onFrame((frame) => frames.push(frame.seq))
    expect(frames[0]).toBe(1)
    expect(frames.at(-1)).toBe(513)
    expect(frames).toHaveLength(512)
    controller.release()
  })
})
