import type { HerdrApiSchema } from './herdr-runtime-contract'
import { HerdrRuntimeError } from './herdr-runtime-contract'

export type HerdrListedSession = { name: string; running: boolean }

export type StockHerdrSessionOps = {
  loadSchema: () => Promise<HerdrApiSchema>
  listSessions: () => Promise<HerdrListedSession[]>
  startServer: (sessionName: string) => Promise<void>
  timeoutMs?: number
  pollMs?: number
  afterReady?: (schema: HerdrApiSchema) => Promise<void>
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
    const schema = await ops.loadSchema()
    const sessions = await ops.listSessions()
    if (!sessions.some((session) => session.name === sessionName && session.running)) {
      await ops.startServer(sessionName)
      await waitForStockHerdrSession(sessionName, ops)
    }
    await ops.afterReady?.(schema)
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
    if (sessions.some((session) => session.name === sessionName && session.running)) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  throw new HerdrRuntimeError(
    'herdr_unavailable',
    `Herdr session ${sessionName} did not start within ${timeoutMs}ms`
  )
}
