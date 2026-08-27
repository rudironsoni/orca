import crypto from 'node:crypto'
import { spawnProcess } from '../../../../shared/child-process/run-process'
import type {
  HerdrHostTransport,
  HerdrResponse,
  HerdrTerminalController,
  HerdrTerminalControlOptions
} from './herdr-runtime-contract'
import { assertHerdrServerCompatible, HerdrRuntimeError } from './herdr-runtime-contract'
import { HerdrSocketConnection, type HerdrSocketConnectionOptions } from './herdr-socket-connection'
import { isHerdrProcessGone } from './herdr-socket-gone'
import { HerdrSocketEventConnection } from './herdr-socket-events'
import {
  createHerdrSessionControlController,
  createHerdrSessionControlFromOpen,
  herdrSessionControlArgs,
  herdrSessionControlStreamFromProcess
} from './herdr-session-control'
import type {
  EventMatch,
  HerdrSocketEvent,
  LayoutApplyParams,
  LayoutApplyResult,
  LayoutExportParams,
  LayoutExportResult,
  LayoutSetSplitRatioParams,
  LayoutSetSplitRatioResult,
  ServerLiveHandoffParams,
  ServerLiveHandoffResult,
  Subscription
} from './herdr-socket-types'
import { HerdrSocketSessionManager } from './herdr-socket-session'

export class HerdrSocketTransport implements HerdrHostTransport {
  private readonly options: HerdrSocketConnectionOptions
  private readonly connectionsBySession = new Map<string, HerdrSocketConnection>()
  private readonly eventConnectionsBySession = new Map<string, HerdrSocketEventConnection>()
  private readonly eventListeners = new Set<(event: HerdrSocketEvent) => void>()
  private readonly recoveries = new Map<string, Promise<void>>()
  private readonly setups = new Map<string, Promise<void>>()
  private readonly eventSetups = new Map<string, Promise<void>>()
  private readonly sessionManager: HerdrSocketSessionManager

  constructor(options: HerdrSocketConnectionOptions, sessionManager?: HerdrSocketSessionManager) {
    this.options = options
    this.sessionManager = sessionManager ?? new HerdrSocketSessionManager(options)
  }

  async ensureSession(sessionName: string): Promise<void> {
    const existing = this.setups.get(sessionName)
    if (existing) {
      return await existing
    }
    const pending = this.ensureSessionConnection(sessionName)
    this.setups.set(sessionName, pending)
    try {
      await pending
    } finally {
      if (this.setups.get(sessionName) === pending) {
        this.setups.delete(sessionName)
      }
    }
  }

  private async ensureSessionConnection(sessionName: string): Promise<void> {
    const existing = this.connectionsBySession.get(sessionName)
    if (existing) {
      try {
        await existing.connect()
        await this.assertServerProtocolMatches(existing)
        void this.ensureEventSubscription(sessionName).catch((error: unknown) => {
          console.error(
            '[herdr] Event connection failed:',
            error instanceof Error ? error.message : error
          )
        })
        return
      } catch (error) {
        if (!isHerdrProcessGone(error)) {
          throw error
        }
        this.connectionsBySession.delete(sessionName)
      }
    }
    await this.sessionManager.ensureSession(sessionName)
    const connection = new HerdrSocketConnection({ ...this.options, sessionName })
    this.connectionsBySession.set(sessionName, connection)
    try {
      await connection.connect()
      await this.assertServerProtocolMatches(connection)
    } catch (error) {
      if (this.connectionsBySession.get(sessionName) === connection) {
        this.connectionsBySession.delete(sessionName)
      }
      throw error
    }
    void this.ensureEventSubscription(sessionName).catch((error: unknown) => {
      console.error(
        '[herdr] Event connection failed:',
        error instanceof Error ? error.message : error
      )
    })
  }

  private async assertServerProtocolMatches(connection: HerdrSocketConnection): Promise<void> {
    const schema = await this.sessionManager.compatibleSchema()
    const snapshot = await connection.request<{ snapshot: { protocol: number } }>(
      'session.snapshot',
      {}
    )
    assertHerdrServerCompatible(schema, snapshot.snapshot.protocol)
  }

  private connectionFor(sessionName: string): HerdrSocketConnection {
    const connection = this.connectionsBySession.get(sessionName)
    if (!connection) {
      throw new Error(`Herdr socket transport not initialized for session ${sessionName}`)
    }
    return connection
  }

  private async raw<T>(sessionName: string, method: string, params: unknown): Promise<T> {
    try {
      return await this.connectionFor(sessionName).request<T>(method, params)
    } catch (error) {
      if (!isHerdrProcessGone(error)) {
        throw error
      }
      await this.recoverSession(sessionName)
      return await this.connectionFor(sessionName).request<T>(method, params)
    }
  }

  // Socket-only helpers without a session argument route to the session this
  // transport was created for (the shared default session).
  private async sockRaw<T>(method: string, params: unknown): Promise<T> {
    return await this.raw(this.options.sessionName, method, params)
  }

  async request<T>(
    sessionName: string,
    method: string,
    params: unknown
  ): Promise<HerdrResponse<T>> {
    try {
      const result = await this.raw<T>(sessionName, method, params)
      return { id: crypto.randomUUID(), result }
    } catch (error) {
      return {
        id: crypto.randomUUID(),
        error: {
          code: error instanceof HerdrRuntimeError ? error.code : 'herdr_request_failed',
          message: error instanceof Error ? error.message : String(error)
        }
      }
    }
  }

  controlTerminal(
    sessionName: string,
    target: string,
    options: HerdrTerminalControlOptions
  ): HerdrTerminalController {
    if (!this.options.commandFor) {
      throw new Error('Stock Herdr terminal control requires a herdr command')
    }
    const command = this.options.commandFor(herdrSessionControlArgs(sessionName, target, options))
    if (command instanceof Promise) {
      return createHerdrSessionControlFromOpen(async () => {
        const resolved = await command
        return herdrSessionControlStreamFromProcess(
          spawnProcess({ program: resolved.file, args: resolved.args, env: resolved.env })
        )
      })
    }
    return createHerdrSessionControlController(command)
  }

  onEvent(listener: (event: HerdrSocketEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  private async ensureEventSubscription(sessionName: string): Promise<void> {
    const existingSetup = this.eventSetups.get(sessionName)
    if (existingSetup) {
      return await existingSetup
    }
    const pending = (async () => {
      let connection = this.eventConnectionsBySession.get(sessionName)
      if (!connection) {
        connection = new HerdrSocketEventConnection({
          ...this.options,
          sessionName
        })
        this.eventConnectionsBySession.set(sessionName, connection)
        connection.onEvent((event) => {
          const tagged = { ...event, sessionName }
          for (const listener of this.eventListeners) {
            listener(tagged)
          }
        })
      }
      try {
        await connection.connect()
      } catch (error) {
        if (this.eventConnectionsBySession.get(sessionName) === connection) {
          this.eventConnectionsBySession.delete(sessionName)
        }
        await connection.disconnect()
        throw error
      }
    })()
    this.eventSetups.set(sessionName, pending)
    try {
      await pending
    } finally {
      if (this.eventSetups.get(sessionName) === pending) {
        this.eventSetups.delete(sessionName)
      }
    }
  }

  async isConnected(): Promise<boolean> {
    return this.connectionsBySession.size > 0
  }

  async disconnect(): Promise<void> {
    for (const connection of this.eventConnectionsBySession.values()) {
      await connection.disconnect()
    }
    this.eventConnectionsBySession.clear()
    this.eventListeners.clear()
    this.connectionsBySession.clear()
  }

  async eventsSubscribe(subscriptions: Subscription[]): Promise<void> {
    await this.ensureEventSubscription(this.options.sessionName)
    void subscriptions
  }

  async eventsWait(match: EventMatch, timeoutMs?: number): Promise<HerdrSocketEvent> {
    return await this.sockRaw<HerdrSocketEvent>('events.wait', {
      match_event: match,
      timeout_ms: timeoutMs
    })
  }

  async layoutExport(params: LayoutExportParams): Promise<LayoutExportResult> {
    return await this.sockRaw('layout.export', params)
  }
  async layoutApply(params: LayoutApplyParams): Promise<LayoutApplyResult> {
    return await this.sockRaw('layout.apply', params)
  }
  async layoutSetSplitRatio(params: LayoutSetSplitRatioParams): Promise<LayoutSetSplitRatioResult> {
    return await this.sockRaw('layout.set_split_ratio', params)
  }

  async serverLiveHandoff(params: ServerLiveHandoffParams): Promise<ServerLiveHandoffResult> {
    return await this.sockRaw('server.live_handoff', params)
  }
  async serverStop(): Promise<unknown> {
    return await this.sockRaw('server.stop', {})
  }
  async serverReloadConfig(): Promise<unknown> {
    return await this.sockRaw('server.reload_config', {})
  }
  async serverAgentManifests(): Promise<unknown> {
    return await this.sockRaw('server.agent_manifests', {})
  }
  async serverReloadAgentManifests(): Promise<unknown> {
    return await this.sockRaw('server.reload_agent_manifests', {})
  }

  async ping(): Promise<unknown> {
    return await this.sockRaw('ping', {})
  }

  async workspaceList(): Promise<unknown> {
    return await this.sockRaw('workspace.list', {})
  }

  private async recoverSession(sessionName: string): Promise<void> {
    const existing = this.recoveries.get(sessionName)
    if (existing) {
      return await existing
    }
    const pending = (async () => {
      const events = this.eventConnectionsBySession.get(sessionName)
      this.eventConnectionsBySession.delete(sessionName)
      this.connectionsBySession.delete(sessionName)
      await events?.disconnect()
      await this.ensureSession(sessionName)
    })()
    this.recoveries.set(sessionName, pending)
    try {
      await pending
    } finally {
      if (this.recoveries.get(sessionName) === pending) {
        this.recoveries.delete(sessionName)
      }
    }
  }
}

export { isHerdrProcessGone } from './herdr-socket-gone'
