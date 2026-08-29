import { runKeyedSerializedOperation } from '../../../cli/keyed-promise-queue'
import type { HerdrHostTransport, HerdrSessionSnapshot } from './herdr-runtime-contract'
import { rememberOrcaPaneBindings } from './herdr-binding-metadata'
import {
  collectHerdrSurfaceActions,
  resolveHerdrPaneIdentities,
  type HerdrOrcaSurfaceAction
} from './herdr-orca-surface-actions'
import {
  claimAndPresentHerdrSurfaces,
  collectUnboundHerdrSurfaces,
  type HerdrImportedSurface,
  type HerdrSurfacePresenter
} from './herdr-orca-surface-import'
import type { HerdrProjectHostGraph } from './ensure-herdr-workspace'

const RECONCILE_EVENT_DEBOUNCE_MS = 150

const RECONCILE_EVENT_KINDS = new Set([
  'session.snapshot_changed',
  'workspace.created',
  'workspace.updated',
  'workspace.metadata_updated',
  'workspace.closed',
  'workspace.renamed',
  'workspace.moved',
  'workspace.reordered',
  'workspace.focused',
  'worktree.created',
  'worktree.opened',
  'worktree.removed',
  'tab.created',
  'tab.closed',
  'tab.renamed',
  'tab.moved',
  'tab.focused',
  'pane.created',
  'pane.closed',
  'pane.updated',
  'pane.focused',
  'pane.moved',
  'pane.exited',
  'layout.updated'
])

export type HerdrLivePaneListener = (sessionName: string, paneIds: ReadonlySet<string>) => void
export type HerdrPaneExitListener = (sessionName: string, paneId: string) => void

export type HerdrSurfaceSync = {
  persist: (surface: HerdrImportedSurface) => void
  present?: HerdrSurfacePresenter
  presentAction?: (action: HerdrOrcaSurfaceAction) => void
}

function herdrEventKind(event: string): string {
  return event.includes('.') ? event : event.replaceAll('_', '.')
}

function herdrEventPaneId(data: Record<string, unknown>): string | null {
  return typeof data.pane_id === 'string' ? data.pane_id : null
}

function graphsForSession(
  graphsByKey: Map<string, HerdrProjectHostGraph>,
  sessionName: string
): HerdrProjectHostGraph[] {
  const prefix = `${sessionName}\n`
  return [...graphsByKey.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([, graph]) => graph)
}

export type HerdrEventRefreshHost = {
  transport: HerdrHostTransport
  graphsByKey: Map<string, HerdrProjectHostGraph>
  reconcileQueues: Map<string, Promise<void>>
  paneIdsBySessionAndBinding: Map<string, string>
  lastSnapshots: Map<string, HerdrSessionSnapshot>
  surfaceSync?: HerdrSurfaceSync
  onLivePaneIds?: HerdrLivePaneListener
  onPaneExited?: HerdrPaneExitListener
  snapshot: (sessionName: string) => Promise<HerdrSessionSnapshot>
}

export class HerdrEventRefresh {
  private readonly eventRefreshTimers = new Map<string, NodeJS.Timeout>()
  private eventUnsubscribe: (() => void) | null = null

  constructor(private readonly host: HerdrEventRefreshHost) {}

  ensureSubscription(): void {
    if (this.eventUnsubscribe || !this.host.transport.onEvent) {
      return
    }
    this.eventUnsubscribe = this.host.transport.onEvent((event) => {
      const kind = herdrEventKind(event.event)
      const sessionNames = event.sessionName
        ? [event.sessionName]
        : [...this.host.graphsByKey.keys()].map((key) => key.slice(0, key.indexOf('\n')))
      if (kind === 'pane.exited') {
        const paneId = herdrEventPaneId(event.data)
        if (paneId) {
          for (const sessionName of sessionNames) {
            this.host.onPaneExited?.(sessionName, paneId)
          }
        }
      }
      if (!RECONCILE_EVENT_KINDS.has(kind) && !RECONCILE_EVENT_KINDS.has(event.event)) {
        return
      }
      for (const sessionName of sessionNames) {
        this.schedule(sessionName)
      }
    })
  }

  dispose(): void {
    for (const timer of this.eventRefreshTimers.values()) {
      clearTimeout(timer)
    }
    this.eventRefreshTimers.clear()
    if (this.eventUnsubscribe) {
      this.eventUnsubscribe()
      this.eventUnsubscribe = null
    }
  }

  private schedule(sessionName: string): void {
    const existing = this.eventRefreshTimers.get(sessionName)
    if (existing) {
      clearTimeout(existing)
    }
    const timer = setTimeout(() => {
      this.eventRefreshTimers.delete(sessionName)
      void this.refresh(sessionName).catch((error) => {
        console.error(
          `[herdr] Event reconcile for ${sessionName} failed:`,
          error instanceof Error ? error.message : error
        )
      })
    }, RECONCILE_EVENT_DEBOUNCE_MS)
    this.eventRefreshTimers.set(sessionName, timer)
  }

  private async refresh(sessionName: string): Promise<void> {
    const graphs = graphsForSession(this.host.graphsByKey, sessionName)
    if (graphs.length === 0) {
      return
    }
    await runKeyedSerializedOperation(this.host.reconcileQueues, sessionName, async () => {
      const snapshot = await this.host.snapshot(sessionName)
      for (const graph of graphs) {
        rememberOrcaPaneBindings(
          this.host.paneIdsBySessionAndBinding,
          sessionName,
          graph.project.id,
          snapshot
        )
      }
      this.host.onLivePaneIds?.(sessionName, new Set(snapshot.panes.map((pane) => pane.pane_id)))
      await this.importUnboundSurfaces(sessionName, graphs, snapshot)
      this.applySurfaceActions(sessionName, graphs, snapshot)
      this.host.lastSnapshots.set(sessionName, snapshot)
    })
  }

  private applySurfaceActions(
    sessionName: string,
    graphs: HerdrProjectHostGraph[],
    snapshot: HerdrSessionSnapshot
  ): void {
    if (!this.host.surfaceSync?.presentAction) {
      this.host.lastSnapshots.set(sessionName, snapshot)
      return
    }
    const actions = collectHerdrSurfaceActions(
      this.host.lastSnapshots.get(sessionName) ?? null,
      snapshot,
      resolveHerdrPaneIdentities(sessionName, graphs, this.host.paneIdsBySessionAndBinding)
    )
    for (const action of actions) {
      this.host.surfaceSync.presentAction(action)
    }
  }

  private async importUnboundSurfaces(
    sessionName: string,
    graphs: HerdrProjectHostGraph[],
    snapshot: HerdrSessionSnapshot
  ): Promise<void> {
    if (!this.host.surfaceSync) {
      return
    }
    for (const graph of graphs) {
      const surfaces = collectUnboundHerdrSurfaces(
        sessionName,
        graph,
        snapshot,
        this.host.paneIdsBySessionAndBinding
      )
      if (surfaces.length === 0) {
        continue
      }
      await claimAndPresentHerdrSurfaces(
        this.host.transport,
        sessionName,
        graph.project.id,
        snapshot,
        surfaces,
        this.host.surfaceSync.persist,
        this.host.surfaceSync.present
      )
      rememberOrcaPaneBindings(
        this.host.paneIdsBySessionAndBinding,
        sessionName,
        graph.project.id,
        snapshot
      )
    }
  }
}
