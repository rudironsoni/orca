import { randomUUID } from 'node:crypto'
import type { HerdrProjectHostGraph } from './ensure-herdr-workspace'
import { encodeHerdrPtyId } from './herdr-pty-types'
import type {
  HerdrPane,
  HerdrHostTransport,
  HerdrSessionSnapshot,
  HerdrTab
} from './herdr-runtime-contract'
import {
  ORCA_BINDING_TOKEN,
  claimOrcaPaneBinding,
  collectLeafIds,
  orcaPaneBinding,
  orcaWorkspaceBinding,
  paneBindingMapKey
} from './herdr-binding-metadata'
import { fromOption } from './herdr-sdk-values'
import { isStockHerdrDefaultTabLabel } from './herdr-tab-layout'

export type HerdrImportedSurface = {
  worktreeId: string
  tabId: string
  leafId: string
  paneId: string
  ptyId: string
  title?: string
  cwd?: string
  splitFromLeafId?: string
  splitDirection?: 'vertical' | 'horizontal'
}

export type HerdrSurfacePresenter = (surface: HerdrImportedSurface) => void

export function collectUnboundHerdrSurfaces(
  sessionName: string,
  graph: HerdrProjectHostGraph,
  snapshot: HerdrSessionSnapshot,
  paneIdsBySessionAndBinding: Map<string, string>
): HerdrImportedSurface[] {
  const imported: HerdrImportedSurface[] = []
  for (const worktree of graph.worktrees) {
    const workspaceBinding = orcaWorkspaceBinding(graph.project.id, worktree)
    const workspace = snapshot.workspaces.find(
      (candidate) => candidate.tokens?.[ORCA_BINDING_TOKEN] === workspaceBinding
    )
    if (!workspace) {
      continue
    }
    const tabs = snapshot.tabs.filter((tab) => tab.workspaceId === workspace.id)
    for (const tab of tabs) {
      imported.push(
        ...collectUnboundTabSurfaces(
          sessionName,
          graph,
          worktree.id,
          tab,
          snapshot,
          paneIdsBySessionAndBinding
        )
      )
    }
  }
  return imported
}

function collectUnboundTabSurfaces(
  sessionName: string,
  graph: HerdrProjectHostGraph,
  worktreeId: string,
  tab: HerdrTab,
  snapshot: HerdrSessionSnapshot,
  paneIdsBySessionAndBinding: Map<string, string>
): HerdrImportedSurface[] {
  const panes = snapshot.panes.filter((pane) => pane.tabId === tab.id)
  const claimedPaneIds = new Set(paneIdsBySessionAndBinding.values())
  const unbound = panes.filter(
    (pane) => !pane.tokens?.[ORCA_BINDING_TOKEN] && !claimedPaneIds.has(pane.id)
  )
  const owner = findOrcaOwnerForHerdrTab(
    sessionName,
    graph,
    worktreeId,
    panes,
    paneIdsBySessionAndBinding
  )
  if (!owner && (graph.tabsByWorktreeId[worktreeId] ?? []).length > 0) {
    const herdrTabsInWorkspace = snapshot.tabs.filter(
      (candidate) => candidate.workspaceId === tab.workspaceId
    )
    if (herdrTabsInWorkspace.length <= 1 || isStockHerdrDefaultTabLabel(tab.label)) {
      return []
    }
  }
  if (!owner) {
    if (unbound.length === 0 || unbound.length !== panes.length) {
      return []
    }
    const tabId = randomUUID()
    const rootLeafId = randomUUID()
    return unbound.map((pane, index) =>
      surfaceFor(
        graph,
        worktreeId,
        tabId,
        index === 0 ? rootLeafId : randomUUID(),
        pane,
        tab.label,
        index === 0 ? undefined : rootLeafId,
        snapshot,
        tab.id
      )
    )
  }
  if (unbound.length === 0) {
    return []
  }
  return unbound.map((pane) => {
    const leafId = randomUUID()
    return surfaceFor(
      graph,
      worktreeId,
      owner.tabId,
      leafId,
      pane,
      tab.label,
      owner.leafId,
      snapshot,
      tab.id
    )
  })
}

function findOrcaOwnerForHerdrTab(
  sessionName: string,
  graph: HerdrProjectHostGraph,
  worktreeId: string,
  panes: HerdrPane[],
  paneIdsBySessionAndBinding: Map<string, string>
): { tabId: string; leafId: string } | null {
  const paneIds = new Set(panes.map((pane) => String(pane.id)))
  for (const tab of graph.tabsByWorktreeId[worktreeId] ?? []) {
    const root = graph.layoutsByTabId[tab.id]?.root
    const leafIds = root ? collectLeafIds(root) : []
    for (const leafId of leafIds) {
      const paneId = paneIdsBySessionAndBinding.get(
        paneBindingMapKey(sessionName, orcaPaneBinding(graph.project.id, leafId))
      )
      if (paneId && paneIds.has(paneId)) {
        return { tabId: tab.id, leafId }
      }
    }
  }
  return null
}

function surfaceFor(
  graph: HerdrProjectHostGraph,
  worktreeId: string,
  tabId: string,
  leafId: string,
  pane: HerdrPane,
  title: string | undefined,
  splitFromLeafId: string | undefined,
  snapshot: HerdrSessionSnapshot,
  herdrTabId: string
): HerdrImportedSurface {
  const ptyId = encodeHerdrPtyId({
    version: 2,
    hostId: graph.hostId ?? 'local',
    projectId: graph.project.id,
    worktreeId,
    tabId,
    leafId,
    paneId: pane.id
  })
  return {
    worktreeId,
    tabId,
    leafId,
    paneId: pane.id,
    ptyId,
    title,
    cwd: fromOption(pane.cwd) ?? fromOption(pane.foregroundCwd),
    ...(splitFromLeafId
      ? {
          splitFromLeafId,
          splitDirection: splitDirectionFor(snapshot, herdrTabId)
        }
      : {})
  }
}

function splitDirectionFor(
  snapshot: HerdrSessionSnapshot,
  tabId: string
): 'vertical' | 'horizontal' {
  const layout = snapshot.layouts.find((candidate) => candidate.tabId === tabId)
  const split = layout?.splits?.[0]
  if (split && 'direction' in split && split.direction === 'down') {
    return 'horizontal'
  }
  return 'vertical'
}

export async function claimAndPresentHerdrSurfaces(
  transport: HerdrHostTransport,
  sessionName: string,
  projectId: string,
  snapshot: HerdrSessionSnapshot,
  surfaces: HerdrImportedSurface[],
  persist: (surface: HerdrImportedSurface) => void,
  present?: HerdrSurfacePresenter
): Promise<void> {
  for (const surface of surfaces) {
    const binding = orcaPaneBinding(projectId, surface.leafId)
    const pane = snapshot.panes.find((candidate) => candidate.id === surface.paneId)
    if (!pane) {
      continue
    }
    const claimed = await claimOrcaPaneBinding(
      transport,
      sessionName,
      projectId,
      surface.leafId,
      pane,
      snapshot
    )
    if (!claimed && pane.tokens?.[ORCA_BINDING_TOKEN] !== binding) {
      continue
    }
    persist(surface)
    present?.(surface)
  }
}
