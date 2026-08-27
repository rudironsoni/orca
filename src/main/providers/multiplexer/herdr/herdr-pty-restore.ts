import { randomUUID } from 'node:crypto'
import { herdrSessionNameForProject } from '../../../../shared/horca/herdr-session-identity'
import type { PtySpawnOptions, PtySpawnResult } from '../../types'
import { assertHerdrMigrationReady, decodeHerdrPtyId } from './herdr-pty-types'
import type { HerdrPtyBinding, HerdrPtyIdentity, HerdrPtyTarget } from './herdr-pty-types'
import type { HerdrRuntimeManager } from './herdr-runtime-manager'
import type { HerdrHostTransport } from './herdr-runtime-contract'
import { applyHerdrPaneSize, openSharedHerdrPaneController } from './herdr-pty-attach'

export async function attachHerdrPty(args: {
  id: string
  bindings: Map<string, HerdrPtyBinding>
  resolveTarget: (
    opts: PtySpawnOptions,
    identity: HerdrPtyIdentity
  ) => Promise<HerdrPtyTarget | null>
  runtimeFor: (target: HerdrPtyTarget) => {
    manager: HerdrRuntimeManager
    transport: HerdrHostTransport
  }
  sharedName?: () => string | undefined
  bind: (
    input: Omit<HerdrPtyBinding, 'sequenceChars' | 'snapshot' | 'detached' | 'unsubscribe'>
  ) => HerdrPtyBinding
  waitForFirstFrame: (binding: HerdrPtyBinding) => Promise<{ data: string } | null>
  emitReplay: (payload: { id: string; data: string }) => void
}): Promise<Pick<PtySpawnResult, 'providerSequence'> | void> {
  if (args.bindings.has(args.id)) {
    return
  }
  const identity = decodeHerdrPtyId(args.id)
  if (!identity) {
    throw new Error(`Invalid herdr PTY ID: ${args.id}`)
  }
  const target = await args.resolveTarget(
    {
      cols: 80,
      rows: 24,
      sessionId: args.id,
      worktreeId: identity.worktreeId,
      tabId: identity.tabId,
      paneKey: `${identity.tabId}:${identity.leafId}`
    },
    identity
  )
  if (!target) {
    throw new Error(`Cannot resolve persisted Herdr PTY ${args.id}`)
  }
  await assertHerdrMigrationReady(target)
  const runtime = args.runtimeFor(target)
  await runtime.manager.reconcileProjectHost(target.graph)
  await target.activateHerdr?.()
  const sessionName = herdrSessionNameForProject(target.project, args.sharedName?.())
  const paneId =
    runtime.manager.getPaneId(sessionName, identity.projectId, identity.leafId) ?? identity.paneId
  if (!paneId) {
    throw new Error(`Herdr pane is not reconciled: ${identity.leafId}`)
  }
  const controller = openSharedHerdrPaneController(runtime.transport, sessionName, paneId, {
    cols: 80,
    rows: 24
  })
  const binding = args.bind({
    id: args.id,
    controller,
    transport: runtime.transport,
    identity,
    paneId,
    sessionName,
    incarnationId: randomUUID(),
    cwd: '',
    cols: 80,
    rows: 24
  })
  applyHerdrPaneSize(binding)
  const firstFrame = await args.waitForFirstFrame(binding)
  if (firstFrame) {
    args.emitReplay({ id: args.id, data: firstFrame.data })
  }
}
