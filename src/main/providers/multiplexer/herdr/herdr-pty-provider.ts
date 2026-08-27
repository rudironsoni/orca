import type { IPtyProvider, PtySpawnOptions, PtySpawnResult, PtyDataEvent } from '../../types'
import { HerdrRuntimeError } from './herdr-runtime-contract'
import { decodeHerdrPtyId } from './herdr-pty-types'
import { spawnHerdrPtyPane } from './herdr-pty-spawn'
import type { HerdrPtyBinding, HerdrPtyIdentity, HerdrPtyTarget } from './herdr-pty-types'
import {
  createBinding,
  getRuntime,
  releaseBinding,
  awaitFirstFrame,
  disposeAll,
  retireMissingHerdrPanes,
  retireExitedHerdrPane,
  closeHerdrBindingSurface,
  emitHerdrPtyData,
  emitHerdrPtyExit,
  emitHerdrPtyReplay,
  killAllHerdrBindings
} from './herdr-pty-provider-runtime'
import { attachHerdrPty } from './herdr-pty-restore'
import { isOrcaFallbackId, subscribeOrcaFallback } from './herdr-pty-orca-fallback'
import type { HerdrHostTransport } from './herdr-runtime-contract'
import type { HerdrRuntimeManager, HerdrSurfaceSync } from './herdr-runtime-manager'
import { HerdrPtyProviderIo } from './herdr-pty-provider-io'
export { decodeHerdrPtyId } from './herdr-pty-types'
export type { HerdrPtyIdentity, HerdrPtyTarget } from './herdr-pty-types'

export type HerdrPtyTargetResolver = (
  opts: PtySpawnOptions,
  persistedIdentity: HerdrPtyIdentity | null
) => Promise<HerdrPtyTarget | null>

export class HerdrPtyProvider extends HerdrPtyProviderIo implements IPtyProvider {
  private readonly managers = new Map<string, HerdrRuntimeManager>()
  private readonly transportForTarget: (target: HerdrPtyTarget) => HerdrHostTransport
  private readonly resolveTarget: HerdrPtyTargetResolver
  private readonly sharedName?: () => string | undefined
  private readonly dataListeners = new Set<(payload: PtyDataEvent) => void>()
  private readonly replayListeners = new Set<(payload: { id: string; data: string }) => void>()
  private readonly exitListeners = new Set<
    (payload: { id: string; code: number; incarnationId?: string }) => void
  >()
  private fallbackUnsub?: () => void

  constructor(
    transportForTarget: (target: HerdrPtyTarget) => HerdrHostTransport,
    resolveTarget: HerdrPtyTargetResolver,
    sharedName?: () => string | undefined,
    private readonly surfaceSync?: HerdrSurfaceSync,
    fallback?: IPtyProvider,
    private readonly disconnectTransports?: () => void
  ) {
    super()
    this.transportForTarget = transportForTarget
    this.resolveTarget = resolveTarget
    this.sharedName = sharedName
    this.bindFallback(fallback)
  }

  get providerGeneration(): number | undefined {
    const generation = (this.fallback as { providerGeneration?: number } | undefined)
      ?.providerGeneration
    return Number.isSafeInteger(generation) ? generation : undefined
  }

  async spawn(opts: PtySpawnOptions): Promise<PtySpawnResult> {
    const persistedIdentity = opts.sessionId ? decodeHerdrPtyId(opts.sessionId) : null
    const target = await this.resolveTarget(opts, persistedIdentity)
    if (!target) {
      if (!this.fallback) {
        throw new HerdrRuntimeError('target_not_found', 'Could not resolve herdr target for spawn')
      }
      return this.fallback.spawn(opts)
    }
    return spawnHerdrPtyPane({
      opts,
      target,
      persistedIdentity,
      fallback: this.fallback,
      sharedName: this.sharedName?.(),
      runtime: this.runtimeFor(target),
      bind: (input) => this.bindController(input),
      waitForFirstFrame: (binding) => this.waitForFirstFrame(binding)
    })
  }

  async attach(id: string): Promise<Pick<PtySpawnResult, 'providerSequence'> | void> {
    if (isOrcaFallbackId(this.bindings, id, this.fallback)) {
      return this.fallback.attach(id)
    }
    return attachHerdrPty({
      id,
      bindings: this.bindings,
      resolveTarget: this.resolveTarget,
      runtimeFor: (target) => this.runtimeFor(target),
      sharedName: this.sharedName,
      bind: (input) => this.bindController(input),
      waitForFirstFrame: (binding) => this.waitForFirstFrame(binding),
      emitReplay: (payload) => this.emitReplay(payload)
    })
  }

  async attachForReconnect(
    id: string,
    expected?: { paneKey?: string; tabId?: string },
    sourceRecovery?: unknown
  ): Promise<unknown> {
    if (isOrcaFallbackId(this.bindings, id, this.fallback)) {
      const attach = (
        this.fallback as IPtyProvider & {
          attachForReconnect?: (
            id: string,
            expected?: { paneKey?: string; tabId?: string },
            sourceRecovery?: unknown
          ) => Promise<unknown>
        }
      ).attachForReconnect
      if (typeof attach !== 'function') {
        throw new Error('ptyProvider.attachForReconnect is not a function')
      }
      return attach.call(this.fallback, id, expected, sourceRecovery)
    }
    return this.attach(id)
  }

  async shutdown(id: string, opts: { immediate?: boolean; keepHistory?: boolean }): Promise<void> {
    const binding = this.bindings.get(id)
    if (!binding) {
      await this.fallback?.shutdown(id, opts)
      return
    }
    if (opts.keepHistory) {
      releaseBinding(binding, this.bindings)
      return
    }
    try {
      await closeHerdrBindingSurface(binding)
    } catch (error) {
      console.warn(
        `[herdr] Failed to close pane ${binding.paneId}:`,
        error instanceof Error ? error.message : error
      )
      throw error
    }
    releaseBinding(binding, this.bindings)
    this.emitExit({ id, code: 0 })
  }

  hasPty(id: string): boolean {
    return this.bindings.has(id) || this.fallback?.hasPty?.(id) === true
  }

  async inspectProcess(id: string) {
    if (isOrcaFallbackId(this.bindings, id, this.fallback)) {
      const inspect = (
        this.fallback as IPtyProvider & {
          inspectProcess?: (id: string) => Promise<{
            foregroundProcess: string | null
            hasChildProcesses: boolean
          }>
        }
      ).inspectProcess
      if (inspect) {
        return inspect.call(this.fallback, id)
      }
      return {
        foregroundProcess: await this.fallback.getForegroundProcess(id),
        hasChildProcesses: await this.fallback.hasChildProcesses(id)
      }
    }
    return {
      foregroundProcess: await this.getForegroundProcess(id),
      hasChildProcesses: await this.hasChildProcesses(id)
    }
  }

  async confirmShellForeground(id: string): Promise<boolean> {
    if (isOrcaFallbackId(this.bindings, id, this.fallback)) {
      return (await this.fallback.confirmShellForeground?.(id)) ?? false
    }
    return false
  }

  onData(callback: (payload: PtyDataEvent) => void): () => void {
    this.dataListeners.add(callback)
    return () => this.dataListeners.delete(callback)
  }

  onReplay(callback: (payload: { id: string; data: string }) => void): () => void {
    this.replayListeners.add(callback)
    return () => this.replayListeners.delete(callback)
  }

  onExit(
    callback: (payload: { id: string; code: number; incarnationId?: string }) => void
  ): () => void {
    this.exitListeners.add(callback)
    return () => this.exitListeners.delete(callback)
  }

  private runtimeFor(target: HerdrPtyTarget) {
    return getRuntime(
      target,
      this.managers,
      this.transportForTarget,
      this.sharedName,
      this.livePaneListener,
      this.surfaceSync,
      this.paneExitListener
    )
  }

  private readonly livePaneListener = (sessionName: string, livePaneIds: ReadonlySet<string>) =>
    retireMissingHerdrPanes(this.bindings, sessionName, livePaneIds, (binding) => {
      releaseBinding(binding, this.bindings)
      this.emitExit({ id: binding.id, code: 0 })
    })

  private readonly paneExitListener = (sessionName: string, paneId: string) =>
    retireExitedHerdrPane(this.bindings, sessionName, paneId, (payload) => this.emitExit(payload))

  private bindController(
    input: Omit<HerdrPtyBinding, 'sequenceChars' | 'snapshot' | 'detached' | 'unsubscribe'>
  ): HerdrPtyBinding {
    return createBinding(input, this.bindings)
  }

  private waitForFirstFrame(binding: HerdrPtyBinding) {
    return awaitFirstFrame(
      binding,
      (payload) => this.emitData(payload),
      (payload) => this.emitExit(payload),
      (payload) => this.emitWriteUnavailable(payload),
      () => releaseBinding(binding, this.bindings)
    )
  }

  private emitData(payload: PtyDataEvent): void {
    emitHerdrPtyData(this.dataListeners, payload)
  }

  private emitExit(payload: { id: string; code: number; incarnationId?: string }): void {
    emitHerdrPtyExit(this.exitListeners, this.bindings, payload)
  }

  private emitReplay(payload: { id: string; data: string }): void {
    emitHerdrPtyReplay(this.replayListeners, payload)
  }

  advanceGeneration(): number {
    return 0
  }

  killOrphanedPtys(_generation: number): void {}

  killAll(): void {
    killAllHerdrBindings(this.bindings)
  }

  dispose(): void {
    this.fallbackUnsub?.()
    this.fallbackUnsub = undefined
    const transports = new Set([...this.bindings.values()].map((binding) => binding.transport))
    disposeAll(this.bindings, this.managers, () => {
      if (this.disconnectTransports) {
        this.disconnectTransports()
      } else {
        for (const transport of transports) {
          void transport.disconnect?.()
        }
      }
    })
  }

  replaceFallback(fallback: IPtyProvider): void {
    this.bindFallback(fallback)
  }

  private bindFallback(fallback: IPtyProvider | undefined): void {
    this.fallbackUnsub?.()
    this.fallback = fallback
    this.fallbackUnsub = fallback
      ? subscribeOrcaFallback(
          fallback,
          (payload) => this.emitData(payload),
          (payload) => this.emitExit(payload),
          (payload) => this.emitReplay(payload),
          (payload) => this.emitBackgroundStreamEvent(payload),
          (payload) => this.emitWriteUnavailable(payload)
        )
      : undefined
  }
}
