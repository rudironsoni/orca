import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localHerdrCommand } from './herdr-cli-session'

const { runProcessMock, spawnProcessMock } = vi.hoisted(() => ({
  runProcessMock: vi.fn(),
  spawnProcessMock: vi.fn()
}))
vi.mock('../../../../shared/child-process/run-process', () => ({
  runProcess: runProcessMock,
  spawnProcess: spawnProcessMock
}))

beforeEach(() => {
  runProcessMock.mockReset()
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

async function loadTransport() {
  const { HerdrCliHostTransport } = await import('./herdr-cli-session')
  const transport = new HerdrCliHostTransport({
    commandFor: localHerdrCommand('/mock/herdr')
  })
  return transport
}

describe('HerdrCliHostTransport', () => {
  it('polls CLI snapshots and emits only real snapshot changes', async () => {
    vi.useFakeTimers()
    const transport = await loadTransport()
    const request = vi.spyOn(transport, 'request')
    request
      .mockResolvedValueOnce({ id: 'first', result: { panes: [{ pane_id: 'p1' }] } })
      .mockResolvedValueOnce({ id: 'second', result: { panes: [{ pane_id: 'p1' }] } })
      .mockResolvedValueOnce({ id: 'third', result: { panes: [{ pane_id: 'p2' }] } })
    const events: string[] = []
    transport.onEvent((event) => events.push(event.event))

    ;(
      transport as unknown as { eventPoller: { start(sessionName: string): void } }
    ).eventPoller.start('main')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(500)
    expect(events).toEqual([])
    await vi.advanceTimersByTimeAsync(500)
    expect(events).toEqual(['session.snapshot_changed'])

    await transport.disconnect()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('parses a JSON response from herdr stdout', async () => {
    const transport = await loadTransport()
    runProcessMock.mockResolvedValue({
      code: 0,
      signal: null,
      stdout: JSON.stringify({ id: '1', result: { sessions: [] } }),
      stderr: '',
      timedOut: false
    })
    await expect(transport.request('main', 'session.snapshot', {})).resolves.toEqual({
      id: '1',
      result: { sessions: [] }
    })
  })

  it('rejects an invalid response from herdr', async () => {
    const transport = await loadTransport()
    runProcessMock.mockResolvedValue({
      code: 0,
      signal: null,
      stdout: 'not json',
      stderr: '',
      timedOut: false
    })
    await expect(transport.request('main', 'session.snapshot', {})).rejects.toMatchObject({
      code: 'herdr_invalid_response'
    })
  })

  it('streams terminal frames and buffers them until subscribed', async () => {
    const transport = await loadTransport()
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
    const transport = await loadTransport()
    const child = createChild()
    spawnProcessMock.mockReturnValue(child)

    const controller = transport.controlTerminal('ws', 'w1:p1', { cols: 80, rows: 24 })
    const closed: unknown[] = []
    controller.onClosed((event) => closed.push(event))
    child.stdout.emit('data', `${JSON.stringify({ type: 'terminal.closed', reason: 'gone' })}\n`)
    expect(closed).toEqual([{ type: 'terminal.closed', reason: 'gone' }])
  })

  it('sends input, resize, and release over stdin', async () => {
    const transport = await loadTransport()
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
    const transport = await loadTransport()
    const child = createChild()
    spawnProcessMock.mockReturnValue(child)

    const controller = transport.controlTerminal('ws', 'w1:p1', { cols: 80, rows: 24 })
    const closed: { reason: string }[] = []
    controller.onClosed((event) => closed.push(event))
    child.emit('close', 1)
    expect(closed.length).toBe(1)
  })
})
