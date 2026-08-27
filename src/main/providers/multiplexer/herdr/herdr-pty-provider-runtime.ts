import type { PtyDataEvent } from '../../types'
import type { HerdrPtyBinding, HerdrPtyTarget } from './herdr-pty-types'
export { decodeHerdrPtyId, encodeHerdrPtyId } from './herdr-pty-types'
import {
  HerdrRuntimeManager,
  type HerdrLivePaneListener,
  type HerdrPaneExitListener,
  type HerdrSurfaceSync
} from './herdr-runtime-manager'
import { unwrapHerdrResponse, type HerdrHostTransport } from './herdr-runtime-contract'
export { awaitFirstFrame } from './herdr-pty-frames'
import { bytesFromTerminalLogicalKey } from '../../../../shared/horca/terminal-logical-key'
import { cancelHerdrPaneSizePulse, writeSharedHerdrInput } from './herdr-pty-attach'

const transportIds = new WeakMap<HerdrHostTransport, number>()
let nextTransportId = 1

function runtimeKey(target: HerdrPtyTarget, transport: HerdrHostTransport): string {
  let id = transportIds.get(transport)
  if (id === undefined) {
    id = nextTransportId
    nextTransportId += 1
    transportIds.set(transport, id)
  }
  return `${target.identity.hostId}\n${id}`
}

function bindController(
  input: Omit<HerdrPtyBinding, 'sequenceChars' | 'snapshot' | 'detached' | 'unsubscribe'>
): HerdrPtyBinding {
  return {
    ...input,
    sequenceChars: 0,
    snapshot: '',
    detached: false,
    unsubscribe: []
  }
}

function detachBinding(binding: HerdrPtyBinding, bindings: Map<string, HerdrPtyBinding>): void {
  if (binding.detached) {
    return
  }
  binding.detached = true
  for (const unsubscribe of binding.unsubscribe.splice(0)) {
    unsubscribe()
  }
  cancelHerdrPaneSizePulse(binding)
  binding.controller.release()
  bindings.delete(binding.id)
}

function disposeProvider(
  bindings: Map<string, HerdrPtyBinding>,
  managers: Map<string, HerdrRuntimeManager>
): void {
  for (const binding of bindings.values()) {
    binding.detached = true
    for (const unsubscribe of binding.unsubscribe.splice(0)) {
      unsubscribe()
    }
    cancelHerdrPaneSizePulse(binding)
    binding.controller.release()
    bindings.delete(binding.id)
  }
  for (const manager of managers.values()) {
    manager.dispose()
  }
  managers.clear()
}

export function getRuntime(
  target: HerdrPtyTarget,
  managers: Map<string, HerdrRuntimeManager>,
  transportForTarget: (target: HerdrPtyTarget) => HerdrHostTransport,
  sharedName: (() => string | undefined) | undefined,
  onLivePaneIds?: HerdrLivePaneListener,
  surfaceSync?: HerdrSurfaceSync,
  onPaneExited?: HerdrPaneExitListener
): {
  manager: HerdrRuntimeManager
  transport: HerdrHostTransport
} {
  const transport = transportForTarget(target)
  const key = runtimeKey(target, transport)
  let manager = managers.get(key)
  if (!manager) {
    manager = new HerdrRuntimeManager(
      transport,
      sharedName,
      onLivePaneIds,
      surfaceSync,
      onPaneExited
    )
    managers.set(key, manager)
  }
  return { manager, transport }
}

export function createBinding(
  input: Omit<HerdrPtyBinding, 'sequenceChars' | 'snapshot' | 'detached' | 'unsubscribe'>,
  bindings: Map<string, HerdrPtyBinding>
): HerdrPtyBinding {
  const previous = bindings.get(input.id)
  if (previous) {
    detachBinding(previous, bindings)
  }
  const binding = bindController(input)
  bindings.set(input.id, binding)
  return binding
}

export function releaseBinding(
  binding: HerdrPtyBinding,
  bindings: Map<string, HerdrPtyBinding>
): void {
  detachBinding(binding, bindings)
}

export function disposeAll(
  bindings: Map<string, HerdrPtyBinding>,
  managers: Map<string, HerdrRuntimeManager>,
  disposeBase: () => void
): void {
  disposeProvider(bindings, managers)
  disposeBase()
}

export function retireMissingHerdrPanes(
  bindings: Map<string, HerdrPtyBinding>,
  sessionName: string,
  livePaneIds: ReadonlySet<string>,
  retire: (binding: HerdrPtyBinding) => void
): void {
  for (const binding of bindings.values()) {
    if (binding.sessionName !== sessionName || livePaneIds.has(binding.paneId)) {
      continue
    }
    retire(binding)
  }
}

export async function sendHerdrNamedKey(binding: HerdrPtyBinding, name: string): Promise<void> {
  try {
    unwrapHerdrResponse(
      await binding.transport.request(binding.sessionName, 'pane.send_keys', {
        pane_id: binding.paneId,
        keys: [name]
      })
    )
  } catch (error: unknown) {
    const bytes = bytesFromTerminalLogicalKey(name)
    if (bytes !== null) {
      await writeSharedHerdrInput(binding, bytes)
      return
    }
    console.warn(`[herdr] pane.send_keys ${name} failed:`, error)
    throw error
  }
}

export async function closeHerdrBindingSurface(binding: HerdrPtyBinding): Promise<void> {
  const { transport, sessionName, paneId } = binding
  try {
    const pane = unwrapHerdrResponse<{ pane: { workspace_id?: string } }>(
      await transport.request(sessionName, 'pane.get', { pane_id: paneId })
    ).pane
    const workspaceId = pane.workspace_id
    if (workspaceId) {
      const listed = unwrapHerdrResponse<{ panes: { pane_id: string }[] }>(
        await transport.request(sessionName, 'pane.list', { workspace_id: workspaceId })
      ).panes
      if (listed.length <= 1) {
        unwrapHerdrResponse(
          await transport.request(sessionName, 'workspace.close', { workspace_id: workspaceId })
        )
        return
      }
    }
  } catch {
    // Last-pane lookup failed; close the pane directly.
  }
  unwrapHerdrResponse(await transport.request(sessionName, 'pane.close', { pane_id: paneId }))
}

export function retireExitedHerdrPane(
  bindings: Map<string, HerdrPtyBinding>,
  sessionName: string,
  paneId: string,
  emitExit: (payload: { id: string; code: number }) => void
): void {
  for (const binding of bindings.values()) {
    if (binding.sessionName !== sessionName || binding.paneId !== paneId || binding.detached) {
      continue
    }
    void closeHerdrBindingSurface(binding).catch(() => undefined)
    releaseBinding(binding, bindings)
    emitExit({ id: binding.id, code: 0 })
  }
}

export function emitHerdrPtyData(
  listeners: Set<(payload: PtyDataEvent) => void>,
  payload: PtyDataEvent
): void {
  for (const listener of listeners) {
    listener(payload)
  }
}

export function emitHerdrPtyExit(
  listeners: Set<(payload: { id: string; code: number; incarnationId?: string }) => void>,
  bindings: Map<string, HerdrPtyBinding>,
  payload: { id: string; code: number; incarnationId?: string }
): void {
  const incarnationId = payload.incarnationId ?? bindings.get(payload.id)?.incarnationId
  const event = incarnationId ? { ...payload, incarnationId } : payload
  for (const listener of listeners) {
    listener(event)
  }
}

export function emitHerdrPtyReplay(
  listeners: Set<(payload: { id: string; data: string }) => void>,
  payload: { id: string; data: string }
): void {
  for (const listener of listeners) {
    listener(payload)
  }
}

export function killAllHerdrBindings(bindings: Map<string, HerdrPtyBinding>): void {
  for (const binding of bindings.values()) {
    void closeHerdrBindingSurface(binding).catch(() => undefined)
    releaseBinding(binding, bindings)
  }
}
