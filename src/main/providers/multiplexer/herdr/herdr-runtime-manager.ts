import type { Project } from '../../../../shared/project-types'
import { herdrSessionNameForProject } from '../../../../shared/horca/herdr-session-identity'
import type {
  HerdrHostTransport,
  HerdrSessionSnapshot,
  HerdrTerminalController,
  HerdrTerminalControlOptions
} from './herdr-runtime-contract'
import { HerdrRuntimeError } from './herdr-runtime-contract'
import {
  enrichHerdrWorkspaceCheckouts,
  ensureStockHerdrWorkspace,
  type HerdrProjectHostGraph
} from './ensure-herdr-workspace'
export type { HerdrProjectHostGraph, HerdrWorktreeDescriptor } from './ensure-herdr-workspace'
import { runKeyedSerializedOperation } from '../../../cli/keyed-promise-queue'
import {
  paneBindingMapKey,
  rememberOrcaPaneBindings,
  orcaPaneBinding,
  orcaWorkspaceBinding,
  collectLeafIds
} from './herdr-binding-metadata'
import { closeUnboundStockHerdrTabs, ensureTabLayout } from './herdr-tab-layout'
import { bindSpawnLeafPane, materializeHerdrLeafPane } from './herdr-leaf-materialize'
import type { HerdrBindingAgentState } from './herdr-pty-binding-queries'
import {
  HerdrEventRefresh,
  type HerdrLivePaneListener,
  type HerdrPaneExitListener,
  type HerdrSurfaceSync
} from './herdr-runtime-event-refresh'
export type { HerdrLivePaneListener, HerdrPaneExitListener, HerdrSurfaceSync }

export type HerdrAgentRollup = {
  agents: HerdrBindingAgentState[]
}

function graphKey(sessionName: string, projectId: string): string {
  return `${sessionName}\n${projectId}`
}

export class HerdrRuntimeManager {
  private readonly paneIdsBySessionAndBinding = new Map<string, string>()
  private readonly reconcileQueues = new Map<string, Promise<void>>()
  private readonly graphsByKey = new Map<string, HerdrProjectHostGraph>()
  private readonly lastSnapshots = new Map<string, HerdrSessionSnapshot>()
  private readonly eventRefresh: HerdrEventRefresh

  constructor(
    private readonly transport: HerdrHostTransport,
    private readonly sharedName?: () => string | undefined,
    private readonly onLivePaneIds?: HerdrLivePaneListener,
    private readonly surfaceSync?: HerdrSurfaceSync,
    private readonly onPaneExited?: HerdrPaneExitListener
  ) {
    this.eventRefresh = new HerdrEventRefresh({
      transport: this.transport,
      graphsByKey: this.graphsByKey,
      reconcileQueues: this.reconcileQueues,
      paneIdsBySessionAndBinding: this.paneIdsBySessionAndBinding,
      lastSnapshots: this.lastSnapshots,
      surfaceSync: this.surfaceSync,
      onLivePaneIds: this.onLivePaneIds,
      onPaneExited: this.onPaneExited,
      snapshot: (sessionName) => this.snapshot(sessionName)
    })
  }

  private paneHintsForRoot(
    sessionName: string,
    projectId: string,
    root: Parameters<typeof collectLeafIds>[0]
  ): Record<string, string> {
    const hints: Record<string, string> = {}
    for (const leafId of collectLeafIds(root)) {
      const paneId = this.getPaneId(sessionName, projectId, leafId)
      if (paneId) {
        hints[leafId] = paneId
      }
    }
    return hints
  }

  private liveWorkspaceBindings(sessionName: string, adoptingWorktreeId: string): Set<string> {
    const live = new Set<string>()
    for (const [key, tracked] of this.graphsByKey) {
      if (!key.startsWith(`${sessionName}\n`)) {
        continue
      }
      for (const worktree of tracked.worktrees) {
        if (worktree.id === adoptingWorktreeId) {
          continue
        }
        live.add(orcaWorkspaceBinding(tracked.project.id, worktree))
      }
    }
    return live
  }

  getPaneId(sessionName: string, projectId: string, leafId: string): string | null {
    return (
      this.paneIdsBySessionAndBinding.get(
        paneBindingMapKey(sessionName, orcaPaneBinding(projectId, leafId))
      ) ?? null
    )
  }

  async reconcileProjectHost(graph: HerdrProjectHostGraph): Promise<HerdrSessionSnapshot> {
    const sessionName = herdrSessionNameForProject(graph.project, this.sharedName?.())
    return runKeyedSerializedOperation(this.reconcileQueues, sessionName, async () => {
      await this.transport.ensureSession(sessionName)
      this.graphsByKey.set(graphKey(sessionName, graph.project.id), graph)
      this.eventRefresh.ensureSubscription()
      let snapshot = await this.snapshot(sessionName)
      snapshot = await enrichHerdrWorkspaceCheckouts(this.transport, sessionName, snapshot)
      if (graph.persistedPaneIdsByLeafId) {
        const live = new Set<string>(snapshot.panes.map((pane) => pane.id))
        graph.persistedPaneIdsByLeafId = Object.fromEntries(
          Object.entries(graph.persistedPaneIdsByLeafId).filter(([, paneId]) => live.has(paneId))
        )
      }

      for (const worktree of graph.worktrees) {
        const tabs = graph.tabsByWorktreeId[worktree.id] ?? []
        const firstTab = tabs.find((tab) => graph.layoutsByTabId[tab.id]?.root)
        if (!firstTab) {
          continue
        }
        const ensured = await ensureStockHerdrWorkspace(
          this.transport,
          sessionName,
          graph.project.id,
          worktree,
          firstTab,
          firstTab ? (graph.layoutsByTabId[firstTab.id]?.root ?? null) : null,
          snapshot,
          this.liveWorkspaceBindings(sessionName, worktree.id)
        )
        const workspace = ensured.workspace
        snapshot = await this.snapshot(sessionName)
        for (const tab of tabs) {
          const root = graph.layoutsByTabId[tab.id]?.root
          if (root) {
            graph.persistedPaneIdsByLeafId ??= {}
            Object.assign(
              graph.persistedPaneIdsByLeafId,
              this.paneHintsForRoot(sessionName, graph.project.id, root)
            )
            await ensureTabLayout(
              this.transport,
              sessionName,
              graph.project.id,
              workspace.id,
              tab,
              root,
              snapshot,
              graph.persistedPaneIdsByLeafId,
              { tab: ensured.seedTab, pane: ensured.seedPane },
              tabs.length <= 1
            )
            for (const leafId of collectLeafIds(root)) {
              const paneId = graph.persistedPaneIdsByLeafId[leafId]
              if (paneId) {
                graph.persistPaneId?.({ worktreeId: worktree.id, tabId: tab.id, leafId, paneId })
              }
            }
          }
        }
        snapshot = await this.snapshot(sessionName)
        const livePaneBindings = new Set<string>()
        for (const tab of tabs) {
          const root = graph.layoutsByTabId[tab.id]?.root
          if (!root) {
            continue
          }
          for (const leafId of collectLeafIds(root)) {
            livePaneBindings.add(orcaPaneBinding(graph.project.id, leafId))
          }
        }
        await closeUnboundStockHerdrTabs(
          this.transport,
          sessionName,
          workspace.id,
          snapshot,
          livePaneBindings
        )
      }

      rememberOrcaPaneBindings(
        this.paneIdsBySessionAndBinding,
        sessionName,
        graph.project.id,
        snapshot
      )
      snapshot = await this.snapshot(sessionName)
      rememberOrcaPaneBindings(
        this.paneIdsBySessionAndBinding,
        sessionName,
        graph.project.id,
        snapshot
      )
      this.onLivePaneIds?.(sessionName, new Set(snapshot.panes.map((pane) => pane.id)))
      this.lastSnapshots.set(sessionName, snapshot)
      return snapshot
    })
  }

  dispose(): void {
    this.eventRefresh.dispose()
    this.graphsByKey.clear()
    this.paneIdsBySessionAndBinding.clear()
    this.lastSnapshots.clear()
    void this.transport.disconnect?.()
  }

  async listAgents(sessionName: string): Promise<HerdrAgentRollup> {
    const agents = await this.transport.sdk.run(sessionName, (herdr) => herdr.agents.list())
    return { agents: agents as unknown as HerdrBindingAgentState[] }
  }

  listSessionNames(): string[] {
    return [...new Set([...this.graphsByKey.keys()].map((key) => key.slice(0, key.indexOf('\n'))))]
  }

  async controlProjectPane(
    project: Project,
    leafId: string,
    options: HerdrTerminalControlOptions
  ): Promise<HerdrTerminalController> {
    if (!this.transport.controlTerminal) {
      throw new Error('Herdr host transport does not support terminal control')
    }
    const sessionName = herdrSessionNameForProject(project, this.sharedName?.())
    const binding = orcaPaneBinding(project.id, leafId)
    const paneId = this.paneIdsBySessionAndBinding.get(paneBindingMapKey(sessionName, binding))
    if (!paneId) {
      throw new HerdrRuntimeError(
        'herdr_binding_missing',
        `Herdr pane is not reconciled for Orca leaf ${leafId}`
      )
    }
    return this.transport.controlTerminal(sessionName, paneId, options)
  }

  async materializeLeafPane(
    project: Project,
    leafId: string,
    cwd: string,
    worktree: { id: string; path: string; displayName?: string }
  ): Promise<string | null> {
    const sessionName = herdrSessionNameForProject(project, this.sharedName?.())
    const graph = this.graphsByKey.get(graphKey(sessionName, project.id))
    return materializeHerdrLeafPane({
      transport: this.transport,
      sessionName,
      project,
      leafId,
      cwd,
      worktree,
      graph,
      paneIdsBySessionAndBinding: this.paneIdsBySessionAndBinding,
      snapshot: () => this.snapshot(sessionName)
    })
  }

  async bindSpawnLeafPane(
    graph: HerdrProjectHostGraph,
    identity: { projectId: string; worktreeId: string; tabId: string; leafId: string }
  ): Promise<string | null> {
    const sessionName = herdrSessionNameForProject(graph.project, this.sharedName?.())
    return runKeyedSerializedOperation(this.reconcileQueues, sessionName, () =>
      bindSpawnLeafPane({
        transport: this.transport,
        sessionName,
        graph,
        identity,
        paneIdsBySessionAndBinding: this.paneIdsBySessionAndBinding,
        liveWorkspaceBindings: this.liveWorkspaceBindings(sessionName, identity.worktreeId),
        snapshot: () => this.snapshot(sessionName)
      })
    )
  }

  private async snapshot(sessionName: string): Promise<HerdrSessionSnapshot> {
    return this.transport.sdk.run(sessionName, (herdr) => herdr.session.snapshot())
  }
}
