import type {
  IPtyProvider,
  PtyProcessInfo,
  PtyProviderBufferSnapshot,
  PtyBackgroundStreamEvent
} from '../../types'
import { applyHerdrPaneSize, writeSharedHerdrInput } from './herdr-pty-attach'
import type {
  HerdrPtyBinding,
  HerdrPaneMoveDestination,
  HerdrPaneSwapOptions
} from './herdr-pty-types'
import {
  clearHerdrBindingBuffer,
  getHerdrBindingBufferSnapshot,
  getHerdrBindingCwd,
  getHerdrBindingForegroundProcess,
  herdrBindingHasChildProcesses,
  herdrBindingProcessSnapshot,
  maybeNotifyBlocked,
  moveHerdrBinding,
  resizeHerdrBinding,
  swapHerdrBinding,
  zoomHerdrBinding
} from './herdr-pty-binding-queries'
import type { TerminalLogicalInput } from '../../../../shared/horca/terminal-logical-key'
import {
  bytesFromTerminalLogicalKey,
  terminalLogicalInputFromBytes
} from '../../../../shared/horca/terminal-logical-key'
import {
  WRITE_ACCEPTED,
  writeRefused,
  writeUnverifiable,
  type WriteSettlement
} from '../../../../shared/pty-write-settlement'
import {
  isHerdrWriteEndpointGone,
  isOrcaFallbackId,
  writeFallbackLogical
} from './herdr-pty-orca-fallback'
import { sendHerdrNamedKey } from './herdr-pty-provider-runtime'

export class HerdrPtyProviderIo {
  protected readonly bindings = new Map<string, HerdrPtyBinding>()
  protected fallback?: IPtyProvider
  protected readonly writeQueues = new Map<string, Promise<void>>()
  protected readonly writeUnavailableListeners = new Set<(payload: { id: string }) => void>()
  protected readonly backgroundStreamListeners = new Set<
    (payload: PtyBackgroundStreamEvent) => void
  >()

  write(id: string, data: string): void {
    if (isOrcaFallbackId(this.bindings, id, this.fallback)) {
      this.fallback.write(id, data)
      return
    }
    this.writeLogical(id, terminalLogicalInputFromBytes(data))
  }

  writeLogical(id: string, input: TerminalLogicalInput): boolean {
    const binding = this.bindings.get(id)
    if (!binding) {
      return writeFallbackLogical(this.fallback, id, input)
    }
    if (input.kind === 'bytes') {
      void this.sendInput(id, () => writeSharedHerdrInput(binding, input.data))
      return true
    }
    const bytes =
      input.name === 'ctrl+c' || input.name === 'ctrl+\\'
        ? null
        : bytesFromTerminalLogicalKey(input.name)
    if (bytes !== null) {
      void this.sendInput(id, () => writeSharedHerdrInput(binding, bytes))
      return true
    }
    void this.sendInput(id, () => sendHerdrNamedKey(binding, input.name))
    return true
  }

  resize(id: string, cols: number, rows: number): void {
    const binding = this.bindings.get(id)
    if (!binding) {
      this.fallback?.resize(id, cols, rows)
      return
    }
    binding.cols = cols
    binding.rows = rows
    binding.controller.resize(cols, rows)
    applyHerdrPaneSize(binding)
  }

  pauseProducer(id: string): void {
    if (isOrcaFallbackId(this.bindings, id, this.fallback)) {
      this.fallback.pauseProducer?.(id)
    }
  }

  resumeProducer(id: string): void {
    if (isOrcaFallbackId(this.bindings, id, this.fallback)) {
      this.fallback.resumeProducer?.(id)
    }
  }

  setPtyBackgrounded(id: string, background: boolean): void {
    if (isOrcaFallbackId(this.bindings, id, this.fallback)) {
      this.fallback.setPtyBackgrounded?.(id, background)
    }
  }

  onBackgroundStreamEvent(callback: (payload: PtyBackgroundStreamEvent) => void): () => void {
    this.backgroundStreamListeners.add(callback)
    return () => this.backgroundStreamListeners.delete(callback)
  }

  onWriteUnavailable(callback: (payload: { id: string }) => void): () => void {
    this.writeUnavailableListeners.add(callback)
    return () => this.writeUnavailableListeners.delete(callback)
  }

  protected emitBackgroundStreamEvent(payload: PtyBackgroundStreamEvent): void {
    for (const listener of this.backgroundStreamListeners) {
      listener(payload)
    }
  }

  protected emitWriteUnavailable(payload: { id: string }): void {
    for (const listener of this.writeUnavailableListeners) {
      listener(payload)
    }
  }

  async getAppliedSize(id: string): Promise<{ cols: number; rows: number } | null> {
    if (isOrcaFallbackId(this.bindings, id, this.fallback)) {
      return this.fallback.getAppliedSize?.(id) ?? null
    }
    const binding = this.bindings.get(id)
    if (!binding) {
      return null
    }
    return { cols: binding.cols, rows: binding.rows }
  }

  async writeWithSettlement(id: string, data: string): Promise<WriteSettlement> {
    if (isOrcaFallbackId(this.bindings, id, this.fallback)) {
      return this.fallback.writeWithSettlement(id, data)
    }
    const binding = this.bindings.get(id)
    if (!binding) {
      return writeRefused('provider_unavailable')
    }
    try {
      await this.sendInput(id, () => writeSharedHerdrInput(binding, data))
      return WRITE_ACCEPTED
    } catch (error) {
      if (isHerdrWriteEndpointGone(error)) {
        return writeRefused('endpoint_disconnected')
      }
      return writeUnverifiable('endpoint_write_threw', true)
    }
  }

  async getCwd(id: string): Promise<string> {
    if (isOrcaFallbackId(this.bindings, id, this.fallback)) {
      return (await this.fallback.getCwd(id)) ?? ''
    }
    const binding = this.bindings.get(id)
    if (!binding) {
      return ''
    }
    try {
      return await getHerdrBindingCwd(binding)
    } catch {
      return binding.cwd
    }
  }

  async getInitialCwd(id: string): Promise<string> {
    return this.getCwd(id)
  }

  async clearBuffer(id: string): Promise<void> {
    if (isOrcaFallbackId(this.bindings, id, this.fallback)) {
      await this.fallback.clearBuffer(id)
      return
    }
    const binding = this.bindings.get(id)
    if (!binding) {
      return
    }
    await clearHerdrBindingBuffer(binding)
  }

  acknowledgeDataEvent(_id: string, _charCount: number): void {}

  async hasChildProcesses(id: string): Promise<boolean> {
    if (isOrcaFallbackId(this.bindings, id, this.fallback)) {
      return (await this.fallback.hasChildProcesses(id)) ?? false
    }
    const binding = this.bindings.get(id)
    if (!binding) {
      return false
    }
    return herdrBindingHasChildProcesses(binding)
  }

  async getForegroundProcess(id: string): Promise<string | null> {
    if (isOrcaFallbackId(this.bindings, id, this.fallback)) {
      return (await this.fallback.getForegroundProcess(id)) ?? null
    }
    const binding = this.bindings.get(id)
    if (!binding) {
      return null
    }
    return getHerdrBindingForegroundProcess(binding)
  }

  async confirmForegroundProcess(id: string): Promise<string | null> {
    if (isOrcaFallbackId(this.bindings, id, this.fallback)) {
      return (
        (await this.fallback.confirmForegroundProcess?.(id)) ??
        (await this.fallback.getForegroundProcess(id)) ??
        null
      )
    }
    const binding = this.bindings.get(id)
    if (!binding) {
      return null
    }
    return getHerdrBindingForegroundProcess(binding)
  }

  async listProcesses(opts?: { deadlineMs?: number }): Promise<PtyProcessInfo[]> {
    const herdr = [...this.bindings.values()].map(herdrBindingProcessSnapshot)
    const fallback = this.fallback ? await this.fallback.listProcesses(opts) : []
    return [...herdr, ...fallback]
  }

  async getBufferSnapshot(
    id: string,
    opts?: { scrollbackRows?: number }
  ): Promise<PtyProviderBufferSnapshot | null> {
    if (isOrcaFallbackId(this.bindings, id, this.fallback)) {
      return (await this.fallback.getBufferSnapshot?.(id, opts)) ?? null
    }
    const binding = this.bindings.get(id)
    if (!binding) {
      return null
    }
    return getHerdrBindingBufferSnapshot(binding, opts?.scrollbackRows)
  }

  async zoomPane(id: string, mode: 'toggle' | 'on' | 'off' = 'toggle') {
    const binding = this.bindings.get(id)
    return binding ? zoomHerdrBinding(binding, mode) : null
  }

  async swapPane(id: string, params: HerdrPaneSwapOptions) {
    const binding = this.bindings.get(id)
    return binding ? swapHerdrBinding(binding, params) : null
  }

  async movePane(id: string, destination: HerdrPaneMoveDestination, focus?: boolean) {
    const binding = this.bindings.get(id)
    return binding ? moveHerdrBinding(binding, { destination, focus }) : null
  }

  async resizePane(id: string, direction: 'left' | 'right' | 'up' | 'down', amount?: number) {
    const binding = this.bindings.get(id)
    return binding ? resizeHerdrBinding(binding, direction, amount) : null
  }

  async notifyBlocked(
    id: string,
    agent: string,
    state: 'idle' | 'working' | 'blocked' | 'done' | 'unknown'
  ): Promise<void> {
    const binding = this.bindings.get(id)
    if (binding) {
      await maybeNotifyBlocked(binding, agent, state)
    }
  }

  canProvideAuthoritativeBufferSnapshot(id: string): boolean {
    if (this.bindings.has(id)) {
      return true
    }
    if (isOrcaFallbackId(this.bindings, id, this.fallback)) {
      return this.fallback.canProvideAuthoritativeBufferSnapshot?.(id) === true
    }
    return false
  }

  async getDefaultShell(): Promise<string> {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'cmd.exe'
    }
    return process.env.SHELL || '/bin/bash'
  }

  async getProfiles(): Promise<{ name: string; path: string }[]> {
    return []
  }

  serialize(_ids: string[]): Promise<string> {
    return Promise.resolve('')
  }

  revive(_state: string): Promise<void> {
    return Promise.resolve()
  }

  async sendSignal(id: string, signal: string): Promise<void> {
    if (isOrcaFallbackId(this.bindings, id, this.fallback)) {
      await this.fallback.sendSignal(id, signal)
      return
    }
    const binding = this.bindings.get(id)
    if (!binding) {
      throw new Error(`Herdr PTY not found: ${id}`)
    }
    const key = signal === 'SIGINT' ? 'ctrl+c' : signal === 'SIGQUIT' ? 'ctrl+\\' : null
    if (!key) {
      throw new Error(`Herdr does not support signal ${signal}`)
    }
    await this.sendInput(id, () => sendHerdrNamedKey(binding, key))
  }

  protected sendInput(id: string, write: () => Promise<void>): Promise<void> {
    const previous = this.writeQueues.get(id) ?? Promise.resolve()
    const pending = previous.catch(() => undefined).then(write)
    this.writeQueues.set(id, pending)
    void pending
      .catch((error: unknown) => {
        console.warn(`[herdr] Failed to write to ${id}:`, error)
        if (!isHerdrWriteEndpointGone(error)) {
          return
        }
        this.emitWriteUnavailable({ id })
      })
      .finally(() => {
        if (this.writeQueues.get(id) === pending) {
          this.writeQueues.delete(id)
        }
      })
    return pending
  }
}
