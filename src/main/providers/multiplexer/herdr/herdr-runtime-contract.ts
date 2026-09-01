import type {
  Agent,
  EventSubscriptionSpecEncoded,
  HerdrEvent,
  HerdrSdk,
  IHerdrSdk,
  Pane,
  PaneLayoutSnapshot,
  SessionSnapshot,
  Tab,
  Workspace
} from '@herdr/sdk'
import type { Effect } from 'effect'

export const HERDR_SCHEMA_VERSION = 1
/** Latest protocol the vendored SDK was generated against (bundled pin). */
export const HERDR_PROTOCOL_VERSION = 21
/** Handshake accepts stable 0.8.0/0.8.2 and unpublished 21. */
export const HERDR_SUPPORTED_PROTOCOLS = [19, 20, 21] as const

export function isSupportedHerdrProtocol(
  protocol: number
): protocol is (typeof HERDR_SUPPORTED_PROTOCOLS)[number] {
  return (HERDR_SUPPORTED_PROTOCOLS as readonly number[]).includes(protocol)
}

export type HerdrWorkspace = Workspace
export type HerdrTab = Tab
export type HerdrPane = Pane
export type HerdrSessionSnapshot = SessionSnapshot
export type HerdrPaneLayoutSnapshot = PaneLayoutSnapshot
export type HerdrAgentInfo = Agent
export type HerdrAgentStatus = Agent['status']

export type HerdrTerminalFrame = {
  type: 'terminal.frame'
  seq: number
  encoding: 'ansi'
  width: number
  height: number
  full: boolean
  bytes: string
}

export type HerdrTerminalClosed = { type: 'terminal.closed'; reason: string }

export type HerdrTerminalController = {
  write(data: string): void
  resize(cols: number, rows: number): void
  release(): void
  onFrame(listener: (frame: HerdrTerminalFrame) => void): () => void
  onClosed(listener: (event: HerdrTerminalClosed) => void): () => void
}

export type HerdrTerminalControlOptions = {
  cols: number
  rows: number
  takeover?: boolean
  observe?: boolean
}

export type HerdrSdkClient = {
  run<A>(
    sessionName: string,
    operation: (herdr: IHerdrSdk) => Effect.Effect<A, unknown, HerdrSdk>
  ): Promise<A>
  subscribe(
    sessionName: string,
    specs: readonly EventSubscriptionSpecEncoded[],
    listener: (event: HerdrEvent) => void
  ): () => void
  ping(sessionName: string): Promise<void>
  dispose(): Promise<void>
}

export type HerdrHostTransport = {
  ensureSession(sessionName: string): Promise<void>
  sdk: HerdrSdkClient
  controlTerminal?(
    sessionName: string,
    target: string,
    options: HerdrTerminalControlOptions
  ): HerdrTerminalController
  disconnect?(): Promise<void>
}

export class HerdrRuntimeError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'HerdrRuntimeError'
    this.code = code
  }
}

export type {
  HerdrPaneZoomResult,
  HerdrPaneSwapResult,
  HerdrPaneMoveResult,
  HerdrPaneResizeResult,
  HerdrPaneFocusDirectionResult,
  HerdrNotificationShowResult,
  HerdrAgentListResult,
  HerdrAgentReadResult,
  HerdrAgentExplainResult,
  HerdrOutputMatchedResult,
  HerdrPaneNeighborResult,
  HerdrPaneEdgesResult,
  HerdrLayoutNode,
  HerdrLayoutExportResult,
  HerdrLayoutApplyResult,
  HerdrLayoutSetSplitRatioResult,
  HerdrEventEnvelope,
  HerdrEventsSubscribeResult,
  HerdrEventsWaitResult,
  HerdrWorktreeInfo,
  HerdrWorktreeListResult,
  HerdrServerLiveHandoffResult,
  HerdrPingResult
} from './herdr-runtime-contract-results'
