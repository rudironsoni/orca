import { HerdrRuntimeError } from './herdr-runtime-contract'

export type HerdrListedSession = { name: string; running: boolean }

export type StockHerdrSessionOps = {
  listSessions: () => Promise<HerdrListedSession[]>
  startServer: (sessionName: string) => Promise<void>
  timeoutMs?: number
  pollMs?: number
  afterReady?: () => Promise<void>
  socketReady?: (sessionName: string) => Promise<boolean>
}

export async function ensureStockHerdrSession(
  pending: Map<string, Promise<void>>,
  sessionName: string,
  ops: StockHerdrSessionOps
): Promise<void> {
  const existing = pending.get(sessionName)
  if (existing) {
    return await existing
  }
  const run = (async () => {
    const sessions = await ops.listSessions()
    const listedRunning = sessions.some(
      (session) => session.name === sessionName && session.running
    )
    const socketReady = ops.socketReady ? await ops.socketReady(sessionName) : true
    if (!listedRunning || !socketReady) {
      await ops.startServer(sessionName)
      await waitForStockHerdrSession(sessionName, ops)
    }
    await ops.afterReady?.()
  })()
  pending.set(sessionName, run)
  try {
    await run
  } finally {
    if (pending.get(sessionName) === run) {
      pending.delete(sessionName)
    }
  }
}

async function waitForStockHerdrSession(
  sessionName: string,
  ops: StockHerdrSessionOps
): Promise<void> {
  const timeoutMs = ops.timeoutMs ?? 15_000
  const pollMs = ops.pollMs ?? 100
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const sessions = await ops.listSessions().catch(() => [])
    const listedRunning = sessions.some(
      (session) => session.name === sessionName && session.running
    )
    const socketReady = ops.socketReady
      ? await ops.socketReady(sessionName).catch(() => false)
      : true
    if (stockHerdrSessionReady(listedRunning, socketReady, Boolean(ops.socketReady))) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  throw new HerdrRuntimeError(
    'herdr_unavailable',
    `Herdr session ${sessionName} did not start within ${timeoutMs}ms`
  )
}

function stockHerdrSessionReady(
  listedRunning: boolean,
  socketReady: boolean,
  hasSocketProbe: boolean
): boolean {
  return hasSocketProbe ? socketReady : listedRunning
}
