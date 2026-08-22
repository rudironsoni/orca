import { describe, expect, it } from 'vitest'
import { HERDR_PROTOCOL_VERSION, HERDR_SCHEMA_VERSION } from './herdr-runtime-contract'
import { ensureStockHerdrSession } from './herdr-stock-session'

const schema = {
  protocol: HERDR_PROTOCOL_VERSION,
  schema_version: HERDR_SCHEMA_VERSION,
  schemas: {}
}

describe('ensureStockHerdrSession', () => {
  it('starts the server when the named session is not running', async () => {
    const starts: string[] = []
    let running = false
    await ensureStockHerdrSession(new Map(), 'orca', {
      loadSchema: async () => schema,
      listSessions: async () => [{ name: 'orca', running }],
      startServer: async (name) => {
        starts.push(name)
        running = true
      }
    })
    expect(starts).toEqual(['orca'])
  })

  it('does not start a server that is already running', async () => {
    let starts = 0
    await ensureStockHerdrSession(new Map(), 'orca', {
      loadSchema: async () => schema,
      listSessions: async () => [{ name: 'orca', running: true }],
      startServer: async () => {
        starts += 1
      }
    })
    expect(starts).toBe(0)
  })

  it('coalesces concurrent ensure calls for the same session', async () => {
    let starts = 0
    let running = false
    const pending = new Map<string, Promise<void>>()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const ops = {
      loadSchema: async () => schema,
      listSessions: async () => [{ name: 'orca', running }],
      startServer: async () => {
        starts += 1
        running = true
        await gate
      }
    }
    const first = ensureStockHerdrSession(pending, 'orca', ops)
    const second = ensureStockHerdrSession(pending, 'orca', ops)
    release()
    await Promise.all([first, second])
    expect(starts).toBe(1)
  })

  it('runs afterReady when the named session is already running', async () => {
    let ready = 0
    await ensureStockHerdrSession(new Map(), 'orca', {
      loadSchema: async () => schema,
      listSessions: async () => [{ name: 'orca', running: true }],
      startServer: async () => {
        throw new Error('already running')
      },
      afterReady: async () => {
        ready += 1
      }
    })
    expect(ready).toBe(1)
  })

  it('times out when the named session never becomes running', async () => {
    await expect(
      ensureStockHerdrSession(new Map(), 'orca', {
        loadSchema: async () => schema,
        listSessions: async () => [],
        startServer: async () => undefined,
        timeoutMs: 20,
        pollMs: 5
      })
    ).rejects.toMatchObject({
      code: 'herdr_unavailable',
      message: 'Herdr session orca did not start within 20ms'
    })
  })

  it('retries after a failed ensure for the same session name', async () => {
    const pending = new Map<string, Promise<void>>()
    let fail = true
    let running = false
    const ops = {
      loadSchema: async () => schema,
      listSessions: async () => [{ name: 'orca', running }],
      startServer: async () => {
        if (fail) {
          throw new Error('boom')
        }
        running = true
      }
    }
    await expect(ensureStockHerdrSession(pending, 'orca', ops)).rejects.toThrow('boom')
    fail = false
    await ensureStockHerdrSession(pending, 'orca', ops)
    expect(running).toBe(true)
  })
})
