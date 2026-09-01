import { randomUUID } from 'node:crypto'
import { herdrSessionNameForProject } from '../../../../shared/horca/herdr-session-identity'
import { SessionNotFoundError } from '../../../daemon/daemon-errors'
import type { IPtyProvider, PtySpawnOptions, PtySpawnResult } from '../../types'

import type { HerdrHostTransport } from './herdr-runtime-contract'
import {
  assertHerdrMigrationReady,
  encodeHerdrPtyId,
  type HerdrPtyBinding,
  type HerdrPtyIdentity,
  type HerdrPtyTarget
} from './herdr-pty-types'
import { startHerdrAgentIfRequested } from './herdr-agent-kind'
import {
  applyHerdrPaneSize,
  openSharedHerdrPaneController,
  writeSharedHerdrInput
} from './herdr-pty-attach'
import type { HerdrRuntimeManager } from './herdr-runtime-manager'

export async function spawnHerdrPtyPane(args: {
  opts: PtySpawnOptions
  target: HerdrPtyTarget
  persistedIdentity: HerdrPtyIdentity | null
  fallback?: IPtyProvider
  sharedName?: string
  runtime: { manager: HerdrRuntimeManager; transport: HerdrHostTransport }
  bind: (
    input: Omit<HerdrPtyBinding, 'sequenceChars' | 'snapshot' | 'detached' | 'unsubscribe'>
  ) => HerdrPtyBinding
  waitForFirstFrame: (binding: HerdrPtyBinding) => Promise<{
    data: string
    frame: { width: number; height: number }
  } | null>
}): Promise<PtySpawnResult> {
  const { opts, target, persistedIdentity, runtime } = args
  await assertHerdrMigrationReady(target, args.fallback)
  const snapshot = await runtime.manager.reconcileProjectHost(target.graph)
  const sessionName = herdrSessionNameForProject(target.project, args.sharedName)
  const livePaneIds = new Set<string>(snapshot.panes.map((pane) => pane.id))
  let paneId = runtime.manager.getPaneId(
    sessionName,
    target.identity.projectId,
    target.identity.leafId
  )
  if (paneId && !livePaneIds.has(paneId)) {
    paneId = null
  }
  if (!paneId) {
    const worktree =
      target.graph.worktrees.find((candidate) => candidate.id === target.identity.worktreeId) ??
      target.graph.worktrees[0]
    if (worktree) {
      paneId = await runtime.manager.materializeLeafPane(
        target.project,
        target.identity.leafId,
        opts.cwd ?? '',
        worktree
      )
    }
  }
  if (!paneId) {
    paneId = await runtime.manager.bindSpawnLeafPane(target.graph, target.identity)
  }
  await target.activateHerdr?.()
  const attachPaneId = paneId
  if (!attachPaneId) {
    if (opts.attachOnly === true && persistedIdentity !== null) {
      throw new SessionNotFoundError(opts.sessionId ?? '')
    }
    throw new Error(`Herdr pane is not reconciled: ${target.identity.leafId}`)
  }
  const controller = openSharedHerdrPaneController(runtime.transport, sessionName, attachPaneId, {
    cols: opts.cols,
    rows: opts.rows
  })
  const identity: HerdrPtyIdentity = {
    ...target.identity,
    version: 2,
    paneId: attachPaneId
  }
  const id = encodeHerdrPtyId(identity)
  const incarnationId = opts.expectedIncarnationId ?? randomUUID()
  const binding = args.bind({
    id,
    controller,
    transport: runtime.transport,
    identity,
    paneId: attachPaneId,
    sessionName,
    incarnationId,
    cwd: opts.cwd ?? '',
    cols: opts.cols,
    rows: opts.rows
  })
  applyHerdrPaneSize(binding)
  const firstFrame = await args.waitForFirstFrame(binding)
  await startHerdrAgentIfRequested({
    sessionId: opts.sessionId,
    launchAgent: opts.launchAgent,
    command: opts.command,
    sessionName,
    leafId: target.identity.leafId,
    paneId: attachPaneId,
    startAgent: (input) =>
      runtime.transport.sdk.run(sessionName, (herdr) => herdr.agents.start(input)),
    writeCommand: (text) => {
      void writeSharedHerdrInput(binding, text).catch((error: unknown) => {
        console.warn(`[herdr] Failed to write startup command to pane ${attachPaneId}:`, error)
      })
    }
  })
  return {
    id,
    isReattach: !!opts.sessionId,
    ...(incarnationId ? { incarnationId } : {}),
    ...(firstFrame
      ? {
          snapshot: firstFrame.data,
          snapshotCols: firstFrame.frame.width,
          snapshotRows: firstFrame.frame.height
        }
      : {})
  }
}
