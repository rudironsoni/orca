import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { Socket } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HerdrSocketConnection,
  HerdrSocketMessageParser,
  createRequest,
  decodeSocketMessage,
  defaultHerdrSocketPath,
  encodeSocketMessage,
  isSocketEvent,
  isSocketResponse
} from './herdr-socket-connection'
import { HerdrSocketReconnection } from './herdr-socket-events'
import { HERDR_PROTOCOL_VERSION } from './herdr-runtime-contract'
import { HerdrSocketTransport, isHerdrProcessGone } from './herdr-socket-transport'
import type { HerdrSocketSessionManager } from './herdr-socket-session'

const TEST_CONFIG_HOME = '/tmp/orca-herdr-socket-transport-test'

beforeEach(() => {
  vi.stubEnv('XDG_CONFIG_HOME', TEST_CONFIG_HOME)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isHerdrProcessGone', () => {
  it('does not replay a request when the socket closes before its response', () => {
    expect(isHerdrProcessGone(new Error('Herdr socket closed before response'))).toBe(false)
    expect(isHerdrProcessGone(new Error('Herdr request timed out'))).toBe(false)
  })
})

describe('defaultHerdrSocketPath', () => {
  it('derives the session socket path under the herdr config dir', () => {
    expect(defaultHerdrSocketPath('test-session')).toBe(
      join(TEST_CONFIG_HOME, 'herdr', 'sessions', 'test-session', 'herdr.sock')
    )
  })

  it('follows XDG_CONFIG_HOME when stock herdr would', () => {
    vi.stubEnv('XDG_CONFIG_HOME', '/tmp/orca-h-xdg')
    expect(defaultHerdrSocketPath('orca')).toBe(
      join('/tmp/orca-h-xdg', 'herdr', 'sessions', 'orca', 'herdr.sock')
    )
  })

  it('uses the stock named-pipe form on Windows', () => {
    expect(
      defaultHerdrSocketPath('orca', 'win32', {
        USERPROFILE: 'C:\\Users\\orca'
      })
    ).toBe('\\\\.\\pipe\\C:\\Users\\orca\\.config\\herdr\\sessions\\orca\\herdr.sock')
  })
})

describe('HerdrSocketConnection', () => {
  it('reports its session and socket path', () => {
    const connection = new HerdrSocketConnection({ sessionName: 'test-session' })
    const state = connection.getState()
    expect(state.sessionName).toBe('test-session')
    expect(state.socketPath).toContain('herdr/sessions/test-session/herdr.sock')
  })

  it('rejects a request when no server is listening', async () => {
    const connection = new HerdrSocketConnection({
      sessionName: 'missing-session',
      socketPath: '/tmp/does-not-exist-herdr.sock',
      timeoutMs: 500
    })
    await expect(connection.request('workspace.list', {})).rejects.toThrow()
  })
})

describe('socket message framing', () => {
  it('encodes a request as a JSON line', () => {
    const request = { id: '1', method: 'test', params: {} }
    expect(encodeSocketMessage(request)).toBe('{"id":"1","method":"test","params":{}}\n')
  })

  it('creates a request with an explicit id', () => {
    const request = createRequest('test.method', { foo: 'bar' }, 'custom-id')
    expect(request).toEqual({ id: 'custom-id', method: 'test.method', params: { foo: 'bar' } })
  })

  it('creates a request id when none is given', () => {
    const request = createRequest('test.method', {})
    expect(typeof request.id).toBe('string')
    expect(request.id.length).toBeGreaterThan(0)
  })

  it('decodes a response frame', () => {
    expect(decodeSocketMessage('{"id":"1","result":{"type":"pong"}}')).toEqual({
      id: '1',
      result: { type: 'pong' }
    })
    expect(decodeSocketMessage('{"id":"1","error":{"code":"x","message":"y"}}')).toEqual({
      id: '1',
      error: { code: 'x', message: 'y' }
    })
  })

  it('decodes a pushed event frame (event is a string, payload in data)', () => {
    const frame = '{"event":"workspace_created","data":{"type":"workspace_created","workspace":{}}}'
    const decoded = decodeSocketMessage(frame)
    expect(decoded).toEqual({
      event: 'workspace_created',
      data: { type: 'workspace_created', workspace: {} }
    })
    expect(isSocketEvent(decoded)).toBe(true)
    expect(isSocketResponse(decoded)).toBe(false)
  })

  it('rejects malformed lines', () => {
    expect(decodeSocketMessage('not json')).toBeNull()
    expect(decodeSocketMessage('')).toBeNull()
    expect(decodeSocketMessage('   ')).toBeNull()
    // A response without result/error is not a valid frame.
    expect(decodeSocketMessage('{"id":"1"}')).toBeNull()
    // An event frame must carry a string event and object data.
    expect(decodeSocketMessage('{"event":{"type":"x"},"data":{}}')).toBeNull()
  })

  it('classifies responses and events', () => {
    expect(isSocketResponse({ id: '1', result: {} })).toBe(true)
    expect(isSocketResponse({ id: '1', error: { code: 'x', message: 'y' } })).toBe(true)
    expect(isSocketResponse({ event: 'pane_created', data: {} })).toBe(false)
    expect(isSocketEvent({ event: 'pane_created', data: { type: 'pane_created' } })).toBe(true)
    expect(isSocketEvent({ id: '1', result: {} })).toBe(false)
  })
})

describe('HerdrSocketMessageParser', () => {
  it('parses complete JSON lines', () => {
    const parser = new HerdrSocketMessageParser()
    const messages = parser.feed('{"id":"1","result":true}\n{"id":"2","error":{"code":"err"}}\n')
    expect(messages).toEqual([
      { id: '1', result: true },
      { id: '2', error: { code: 'err' } }
    ])
  })

  it('handles partial frames across feeds', () => {
    const parser = new HerdrSocketMessageParser()
    expect(parser.feed('{"id":"1"')).toHaveLength(0)
    const messages = parser.feed(',"result":true}\n')
    expect(messages).toEqual([{ id: '1', result: true }])
  })

  it('parses an interleaved response and pushed event', () => {
    const parser = new HerdrSocketMessageParser()
    const messages = parser.feed(
      '{"id":"sub_1","result":{"type":"subscription_started"}}\n' +
        '{"event":"pane_created","data":{"type":"pane_created","pane_id":"w1:p1"}}\n'
    )
    expect(messages).toHaveLength(2)
    expect(isSocketResponse(messages[0])).toBe(true)
    expect(isSocketEvent(messages[1])).toBe(true)
  })

  it('skips empty lines', () => {
    const parser = new HerdrSocketMessageParser()
    expect(parser.feed('\n\n{"id":"1","result":true}\n\n')).toEqual([{ id: '1', result: true }])
  })

  it('flushes a trailing frame without a newline', () => {
    const parser = new HerdrSocketMessageParser()
    expect(parser.feed('{"id":"1","result":true}')).toHaveLength(0)
    expect(parser.flush()).toEqual([{ id: '1', result: true }])
  })
})

describe('HerdrSocketReconnection', () => {
  it('retries with exponential backoff until the connect fn succeeds', async () => {
    const connectFn = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined)
    const reconnection = new HerdrSocketReconnection(connectFn, {
      enabled: true,
      initialDelayMs: 10,
      maxDelayMs: 100,
      maxAttempts: 3,
      factor: 2
    })
    await reconnection.attemptReconnection()
    expect(connectFn).toHaveBeenCalledTimes(3)
  })

  it('throws after max attempts', async () => {
    const connectFn = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('fail'))
    const reconnection = new HerdrSocketReconnection(connectFn, {
      enabled: true,
      initialDelayMs: 10,
      maxDelayMs: 100,
      maxAttempts: 2,
      factor: 2
    })
    await expect(reconnection.attemptReconnection()).rejects.toThrow('Max reconnection attempts')
  })

  it('uses exponential backoff delays', async () => {
    const connectFn = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('fail'))
    const delays: number[] = []
    const reconnection = new HerdrSocketReconnection(
      connectFn,
      { enabled: true, initialDelayMs: 100, maxDelayMs: 10000, maxAttempts: 5, factor: 2 },
      { onReconnecting: (_attempt, delayMs) => delays.push(delayMs) }
    )
    await reconnection.attemptReconnection().catch(() => undefined)
    expect(delays).toEqual([100, 200, 400, 800, 1600])
  })

  it('does not reconnect when disabled', async () => {
    const connectFn = vi.fn<() => Promise<void>>()
    const reconnection = new HerdrSocketReconnection(connectFn, { enabled: false })
    await expect(reconnection.attemptReconnection()).rejects.toThrow('disabled')
    expect(connectFn).not.toHaveBeenCalled()
  })

  it('cancel stops a pending reconnect', async () => {
    const connectFn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const reconnection = new HerdrSocketReconnection(connectFn, {
      enabled: true,
      initialDelayMs: 50,
      maxAttempts: 5,
      factor: 2
    })
    const pending = reconnection.attemptReconnection()
    reconnection.cancel()
    await pending
    expect(connectFn).not.toHaveBeenCalled()
  })
})

describe('HerdrSocketTransport', () => {
  type ServerSocket = EventEmitter & {
    write: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }

  // A fake Herdr server over a fake socket: answers each request that the
  // transport writes, using the supplied responder, keyed by socket path so
  // tests can tell which session answered.
  function createSocketServer() {
    const sockets: ServerSocket[] = []
    const requests: string[] = []
    let responder: (
      socketPath: string,
      method: string,
      params: unknown
    ) => { result?: unknown; error?: { code: string; message: string } } | null = () => ({
      result: {}
    })
    const factory = (socketPath: string): Socket => {
      const socket = Object.assign(new EventEmitter(), {
        write: vi.fn(() => true),
        destroy: vi.fn()
      }) as unknown as ServerSocket
      sockets.push(socket)
      socket.on('connect', () => {
        setImmediate(() => {
          const written = socket.write.mock.calls[0]?.[0] as string | undefined
          if (written === undefined) {
            return
          }
          const request = JSON.parse(written) as { id: string; method: string; params: unknown }
          requests.push(request.method)
          const body = responder(socketPath, request.method, request.params)
          if (!body) {
            return
          }
          socket.emit('data', Buffer.from(`${JSON.stringify({ id: request.id, ...body })}\n`))
        })
      })
      setImmediate(() => socket.emit('connect'))
      return socket as unknown as Socket
    }
    return {
      sockets,
      requests,
      factory,
      setResponder(
        next: (
          socketPath: string,
          method: string,
          params: unknown
        ) => {
          result?: unknown
          error?: { code: string; message: string }
        } | null
      ): void {
        responder = next
      }
    }
  }

  const sessionManager = {
    ensureSession: async () => undefined,
    compatibleSchema: async () => ({
      protocol: HERDR_PROTOCOL_VERSION,
      schema_version: 1,
      schemas: {}
    })
  } as unknown as HerdrSocketSessionManager

  const disabledReconnection = {
    enabled: false,
    initialDelayMs: 100,
    maxDelayMs: 1000,
    maxAttempts: 5,
    factor: 2
  }

  function sessionSnapshotResponder(
    respond: (
      socketPath: string,
      method: string,
      params: unknown
    ) => { result?: unknown; error?: { code: string; message: string } } | null
  ) {
    return (socketPath: string, method: string, params: unknown) => {
      if (method === 'session.snapshot') {
        return { result: { snapshot: { protocol: HERDR_PROTOCOL_VERSION } } }
      }
      return respond(socketPath, method, params)
    }
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('preserves the Herdr server error code across ensureSession and request', async () => {
    const server = createSocketServer()
    server.setResponder(
      sessionSnapshotResponder((_socketPath, method) => {
        if (method === 'workspace.open') {
          return { error: { code: 'not_git_worktree', message: 'Directory is not a git worktree' } }
        }
        return { result: {} }
      })
    )
    const transport = new HerdrSocketTransport(
      {
        sessionName: 'shared',
        timeoutMs: 500,
        socketFactory: server.factory,
        reconnection: disabledReconnection
      },
      sessionManager
    )
    await transport.ensureSession('alpha')
    const response = await transport.request('alpha', 'workspace.open', {})
    expect(response).toMatchObject({
      error: { code: 'not_git_worktree', message: 'Directory is not a git worktree' }
    })
  })

  it('routes requests to the connection of the requested session', async () => {
    const server = createSocketServer()
    server.setResponder(
      sessionSnapshotResponder((socketPath, method) => {
        if (method !== 'pane.split') {
          return { result: {} }
        }
        const session = socketPath.includes('/sessions/')
          ? (socketPath.split('/sessions/')[1]?.split('/')[0] ?? '')
          : ''
        return { result: { session } }
      })
    )
    const transport = new HerdrSocketTransport(
      {
        sessionName: 'shared',
        timeoutMs: 500,
        socketFactory: server.factory,
        reconnection: disabledReconnection
      },
      sessionManager
    )
    await transport.ensureSession('alpha')
    await transport.ensureSession('beta')
    const forAlpha = await transport.request('alpha', 'pane.split', {})
    const forBeta = await transport.request('beta', 'pane.split', {})
    expect(forAlpha).toMatchObject({ result: { session: 'alpha' } })
    expect(forBeta).toMatchObject({ result: { session: 'beta' } })
  })

  it('restarts the session when the herdr process is gone and retries the request', async () => {
    const server = createSocketServer()
    let down = false
    const originalFactory = server.factory
    const factory = (socketPath: string) => {
      if (down) {
        const socket = Object.assign(new EventEmitter(), {
          write: vi.fn(),
          destroy: vi.fn()
        })
        setImmediate(() =>
          socket.emit('error', Object.assign(new Error('gone'), { code: 'ECONNREFUSED' }))
        )
        return socket as unknown as Socket
      }
      return originalFactory(socketPath)
    }
    let restarts = 0
    const restartingManager = {
      ensureSession: async () => {
        restarts += 1
        down = false
      },
      compatibleSchema: async () => ({
        protocol: HERDR_PROTOCOL_VERSION,
        schema_version: 1,
        schemas: {}
      })
    } as unknown as HerdrSocketSessionManager
    server.setResponder(sessionSnapshotResponder(() => ({ result: { type: 'pong' } })))
    const transport = new HerdrSocketTransport(
      {
        sessionName: 'shared',
        timeoutMs: 500,
        socketFactory: factory,
        reconnection: disabledReconnection
      },
      restartingManager
    )
    await transport.ensureSession('alpha')
    down = true
    const response = await transport.request('alpha', 'ping', {})
    expect(response).toMatchObject({ result: { type: 'pong' } })
    expect(restarts).toBeGreaterThan(1)
  })

  it('does not cache a connection whose initial setup failed', async () => {
    const server = createSocketServer()
    server.setResponder(sessionSnapshotResponder(() => ({ result: { type: 'pong' } })))
    let first = true
    const factory = (socketPath: string): Socket => {
      if (first) {
        first = false
        const socket = Object.assign(new EventEmitter(), {
          write: vi.fn(),
          destroy: vi.fn()
        })
        setImmediate(() =>
          socket.emit('error', Object.assign(new Error('not ready'), { code: 'ECONNREFUSED' }))
        )
        return socket as unknown as Socket
      }
      return server.factory(socketPath)
    }
    const transport = new HerdrSocketTransport(
      {
        sessionName: 'shared',
        timeoutMs: 100,
        socketFactory: factory,
        reconnection: disabledReconnection
      },
      sessionManager
    )

    await expect(transport.ensureSession('alpha')).rejects.toThrow('not ready')
    await expect(transport.ensureSession('alpha')).resolves.toBeUndefined()
    await expect(transport.request('alpha', 'ping', {})).resolves.toMatchObject({
      result: { type: 'pong' }
    })
  })

  it('retries event subscription setup after a failed attempt', async () => {
    const server = createSocketServer()
    let subscriptionAttempts = 0
    server.setResponder(
      sessionSnapshotResponder((_socketPath, method) => {
        if (method === 'events.subscribe') {
          subscriptionAttempts += 1
          return subscriptionAttempts === 1
            ? { error: { code: 'not_ready', message: 'not ready' } }
            : { result: { type: 'subscription_started' } }
        }
        return { result: {} }
      })
    )
    const transport = new HerdrSocketTransport(
      {
        sessionName: 'shared',
        timeoutMs: 100,
        socketFactory: server.factory,
        reconnection: disabledReconnection
      },
      sessionManager
    )
    await transport.ensureSession('alpha')
    await vi.waitFor(() => expect(subscriptionAttempts).toBe(1))

    await transport.ensureSession('alpha')

    await vi.waitFor(() => expect(subscriptionAttempts).toBe(2))
  })

  it('never retries a non-idempotent request after its response times out', async () => {
    const server = createSocketServer()
    const ensureSession = vi.fn(async () => undefined)
    const manager = {
      ensureSession,
      compatibleSchema: async () => ({
        protocol: HERDR_PROTOCOL_VERSION,
        schema_version: 1,
        schemas: {}
      })
    } as unknown as HerdrSocketSessionManager
    server.setResponder(
      sessionSnapshotResponder((_socketPath, method) =>
        method === 'workspace.create' ? null : { result: {} }
      )
    )
    const transport = new HerdrSocketTransport(
      {
        sessionName: 'shared',
        timeoutMs: 30,
        socketFactory: server.factory,
        reconnection: disabledReconnection
      },
      manager
    )
    await transport.ensureSession('alpha')

    const response = await transport.request('alpha', 'workspace.create', { cwd: '/tmp' })

    expect(response).toMatchObject({
      error: { message: 'Request workspace.create timed out' }
    })
    expect(server.requests.filter((method) => method === 'workspace.create')).toHaveLength(1)
    expect(ensureSession).toHaveBeenCalledTimes(1)
  })
})
