import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server, type Socket } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HerdrSocketEventConnection, HerdrSocketReconnection } from './herdr-socket-events'
import type { HerdrSocketEvent } from './herdr-socket-types'

type Harness = {
  dir: string
  sock: string
  server: Server
  connection: Socket | null
  push(frame: unknown): void
  pushRaw(data: string): void
  drop(): void
}

function startHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'herdr-events-'))
  const sock = join(dir, 'herdr.sock')
  let connection: Socket | null = null
  const server = createServer((socket) => {
    connection = socket
    socket.on('data', (chunk) => {
      const line = chunk.toString('utf8').trim()
      if (!line) {
        return
      }
      const request = JSON.parse(line) as { id: string; method: string }
      if (request.method === 'events.subscribe') {
        socket.write(
          `${JSON.stringify({ id: request.id, result: { type: 'subscription_started' } })}\n`
        )
      }
    })
  })
  return {
    dir,
    sock,
    server,
    get connection() {
      return connection
    },
    push(frame: unknown) {
      connection?.write(`${JSON.stringify(frame)}\n`)
    },
    pushRaw(data: string) {
      connection?.write(data)
    },
    drop() {
      connection?.destroy()
    }
  } as Harness
}

describe('HerdrSocketEventConnection', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = startHarness()
    await new Promise<void>((resolve) => harness.server.listen(harness.sock, resolve))
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => harness.server.close(() => resolve()))
    rmSync(harness.dir, { recursive: true, force: true })
  })

  it('subscribes on connect and dispatches pushed events', async () => {
    const events: HerdrSocketEvent[] = []
    const connection = new HerdrSocketEventConnection({
      sessionName: 'test',
      socketPath: harness.sock
    })
    connection.onEvent((event) => events.push(event))
    await connection.connect()
    expect(connection.isConnected()).toBe(true)

    harness.push({ event: 'pane_created', data: { type: 'pane_created', pane_id: 'w1:p1' } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(events).toEqual([
      { event: 'pane_created', data: { type: 'pane_created', pane_id: 'w1:p1' } }
    ])

    await connection.disconnect()
    expect(connection.isConnected()).toBe(false)
  })

  it('unsubscribe stops dispatch for that listener', async () => {
    const events: HerdrSocketEvent[] = []
    const connection = new HerdrSocketEventConnection({
      sessionName: 'test',
      socketPath: harness.sock
    })
    const off = connection.onEvent((event) => events.push(event))
    await connection.connect()
    off()
    harness.push({ event: 'tab_created', data: { type: 'tab_created' } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(events).toHaveLength(0)
    await connection.disconnect()
  })

  it('reconnects and resubscribes after the server drops the connection', async () => {
    const events: HerdrSocketEvent[] = []
    const connection = new HerdrSocketEventConnection({
      sessionName: 'test',
      socketPath: harness.sock,
      reconnection: { enabled: true, initialDelayMs: 20, maxDelayMs: 50, maxAttempts: 5, factor: 1 }
    })
    connection.onEvent((event) => events.push(event))
    await connection.connect()
    expect(connection.isConnected()).toBe(true)

    harness.pushRaw('{"event":"stale","data":')
    harness.drop()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(connection.isConnected()).toBe(true)

    harness.push({ event: 'layout_updated', data: { type: 'layout_updated' } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(events.some((event) => event.event === 'layout_updated')).toBe(true)
    expect(events.some((event) => event.event === 'stale')).toBe(false)
    await connection.disconnect()
  })

  it('invalidates an in-flight reconnect when reset runs during backoff', async () => {
    vi.useFakeTimers()
    const connectFn = vi.fn(async () => undefined)
    const reconnection = new HerdrSocketReconnection(connectFn, {
      enabled: true,
      initialDelayMs: 1000,
      maxDelayMs: 1000,
      maxAttempts: 5,
      factor: 1
    })
    const pending = reconnection.attemptReconnection()
    reconnection.reset()
    await vi.advanceTimersByTimeAsync(1000)
    await pending
    expect(connectFn).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('ignores a second reconnect while one is in flight', async () => {
    vi.useFakeTimers()
    const connectFn = vi.fn(async () => undefined)
    const reconnection = new HerdrSocketReconnection(connectFn, {
      enabled: true,
      initialDelayMs: 1000,
      maxDelayMs: 1000,
      maxAttempts: 5,
      factor: 1
    })
    const first = reconnection.attemptReconnection()
    const second = reconnection.attemptReconnection()
    await vi.advanceTimersByTimeAsync(1000)
    await Promise.all([first, second])
    expect(connectFn).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
