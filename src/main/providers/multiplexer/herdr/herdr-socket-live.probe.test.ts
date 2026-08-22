import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { HerdrSocketTransport } from './herdr-socket-transport'
import { unwrapHerdrResponse } from './herdr-runtime-contract'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { configHomeDir, resolveStockHerdrTestBinary } from './herdr-stock-binary'
import { defaultHerdrSocketPath } from './herdr-socket-connection'

// Live-gated: only runs with HERDR_PROBE=1. Boots an isolated herdr server
// against a scratch HOME so it never touches a real session.
const RUN = process.env.HERDR_PROBE === '1'
const HERDR = resolveStockHerdrTestBinary()

describe.skipIf(!RUN || !HERDR)('live herdr socket probe', () => {
  let server: ChildProcess | null = null
  let probeHome = ''
  let session = ''
  let sock = ''
  const herdr = HERDR as string

  beforeAll(async () => {
    probeHome = configHomeDir()
    session = `probe-${process.pid}`
    const env = probeEnv(probeHome)
    sock = defaultHerdrSocketPath(session, process.platform, env)
    server = spawn(herdr, ['--session', session, 'server'], {
      env,
      stdio: 'ignore'
    })
    for (let i = 0; i < 100 && !existsSync(sock) && !sock.startsWith('\\\\.\\pipe\\'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!sock.startsWith('\\\\.\\pipe\\')) {
      if (!existsSync(sock)) {
        throw new Error(`herdr server socket did not appear at ${sock}`)
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }, 30000)

  afterAll(() => {
    try {
      execFileSync(herdr, ['--session', session, 'server', 'stop'], {
        env: probeEnv(probeHome)
      })
    } catch {
      server?.kill()
    }
    if (probeHome) {
      rmSync(probeHome, { recursive: true, force: true })
    }
  })

  it('round-trips requests, applies a layout, and streams events', async () => {
    const transport = new HerdrSocketTransport({
      sessionName: session,
      socketPath: sock,
      timeoutMs: 5000
    })
    await transport.ensureSession(session)

    const ping = (await transport.ping()) as { protocol?: number }
    expect(ping).toBeDefined()

    const layoutExport = (await transport.layoutExport({})) as {
      layout?: { root?: unknown }
    }
    expect(layoutExport).toBeDefined()

    const events: string[] = []
    transport.onEvent((event) => events.push(event.event))
    await transport.eventsSubscribe([])

    const created = unwrapHerdrResponse<{
      workspace: { workspace_id: string }
    }>(
      await transport.request(session, 'workspace.create', {
        cwd: probeHome,
        label: 'Socket event probe',
        focus: false
      })
    )
    await expect.poll(() => events.length, { timeout: 5000 }).toBeGreaterThan(0)
    await transport.request(session, 'workspace.close', {
      workspace_id: created.workspace.workspace_id
    })

    await transport.disconnect()
    await new Promise((resolve) => setTimeout(resolve, 100))
  }, 30000)
})

function probeEnv(probeHome: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: probeHome,
    USERPROFILE: probeHome,
    XDG_CONFIG_HOME: join(probeHome, '.config')
  }
}
