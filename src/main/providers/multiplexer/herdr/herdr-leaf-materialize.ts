import type { Project } from '../../../../shared/project-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import {
  claimOrcaPaneBinding,
  collectLeafIds,
  ORCA_BINDING_TOKEN,
  orcaPaneBinding,
  paneBindingMapKey,
  rememberOrcaPaneBindings
} from './herdr-binding-metadata'
import {
  ensureStockHerdrWorkspace,
  findHerdrWorkspaceForWorktree,
  type HerdrProjectHostGraph
} from './ensure-herdr-workspace'
import type { HerdrHostTransport, HerdrSessionSnapshot } from './herdr-runtime-contract'
import { reportPaneTokens } from './herdr-sdk-ops'
import { closeUnboundStockHerdrTabs, ensureTabLayout } from './herdr-tab-layout'
import { nextOrcaTerminalTitle } from './herdr-tab-title'

export async function materializeHerdrLeafPane(args: {
  transport: HerdrHostTransport
  sessionName: string
  project: Project
  leafId: string
  cwd: string
  worktree: { id: string; path: string; displayName?: string }
  graph: HerdrProjectHostGraph | undefined
  paneIdsBySessionAndBinding: Map<string, string>
  snapshot: () => Promise<HerdrSessionSnapshot>
}): Promise<string | null> {
  const snapshot = await args.snapshot()
  const worktree =
    args.graph?.worktrees.find((candidate) => candidate.id === args.worktree.id) ?? args.worktree
  const workspace = findHerdrWorkspaceForWorktree(snapshot, args.project.id, worktree)
  const claimedPaneIds = new Set(args.paneIdsBySessionAndBinding.values())
  const workspacePanes = snapshot.panes.filter(
    (pane) => workspace && pane.workspaceId === workspace.id
  )
  // Why: the Orca session is the only authority on which panes exist. A bare
  // pane is reusable, and a pane whose orca_binding names a leaf the session
  // no longer models is a stale leftover of a previous run. Reclaiming it
  // must never mint a new herdr tab.
  const desiredBindings = desiredLeafBindings(args.project.id, args.graph)
  const selfBinding = orcaPaneBinding(args.project.id, args.leafId)
  const alreadyMine = workspacePanes.find(
    (pane) => pane.tokens?.[ORCA_BINDING_TOKEN] === selfBinding
  )
  if (alreadyMine) {
    args.paneIdsBySessionAndBinding.set(
      paneBindingMapKey(args.sessionName, selfBinding),
      alreadyMine.id
    )
    return alreadyMine.id
  }
  const reusable =
    workspacePanes.find(
      (pane) => !claimedPaneIds.has(pane.id) && !pane.tokens?.[ORCA_BINDING_TOKEN]
    ) ??
    workspacePanes.find((pane) => {
      const token = pane.tokens?.[ORCA_BINDING_TOKEN]
      return token !== undefined && !desiredBindings.has(token)
    })
  if (reusable) {
    return claimMaterializedPane(args, reusable, snapshot)
  }
  return null
}

export async function bindSpawnLeafPane(args: {
  transport: HerdrHostTransport
  sessionName: string
  graph: HerdrProjectHostGraph
  identity: { projectId: string; worktreeId: string; tabId: string; leafId: string }
  paneIdsBySessionAndBinding: Map<string, string>
  liveWorkspaceBindings: ReadonlySet<string>
  snapshot: () => Promise<HerdrSessionSnapshot>
}): Promise<string | null> {
  const worktree =
    args.graph.worktrees.find((candidate) => candidate.id === args.identity.worktreeId) ??
    args.graph.worktrees[0]
  if (!worktree) {
    return null
  }
  const snapshot = await args.snapshot()
  const existingTabs = args.graph.tabsByWorktreeId[worktree.id] ?? []
  const tab =
    existingTabs.find((candidate) => candidate.id === args.identity.tabId) ??
    syntheticSpawnTab(args.identity.tabId, worktree.id, existingTabs)
  const layoutRoot = args.graph.layoutsByTabId[args.identity.tabId]?.root
  const root =
    layoutRoot && collectLeafIds(layoutRoot).includes(args.identity.leafId)
      ? layoutRoot
      : { type: 'leaf' as const, leafId: args.identity.leafId }
  const ensured = await ensureStockHerdrWorkspace(
    args.transport,
    args.sessionName,
    args.graph.project.id,
    worktree,
    tab,
    root,
    snapshot,
    args.liveWorkspaceBindings
  )
  const workspace = ensured.workspace
  args.graph.persistedPaneIdsByLeafId ??= {}
  let liveSnapshot = await args.snapshot()
  await ensureTabLayout(
    args.transport,
    args.sessionName,
    args.graph.project.id,
    workspace.id,
    tab,
    root,
    liveSnapshot,
    args.graph.persistedPaneIdsByLeafId,
    { tab: ensured.seedTab, pane: ensured.seedPane },
    existingTabs.length <= 1,
    existingTabs
  )
  liveSnapshot = await args.snapshot()
  const livePaneBindings = desiredLeafBindings(args.graph.project.id, args.graph)
  livePaneBindings.add(orcaPaneBinding(args.identity.projectId, args.identity.leafId))
  await closeUnboundStockHerdrTabs(
    args.transport,
    args.sessionName,
    workspace.id,
    liveSnapshot,
    livePaneBindings
  )
  rememberOrcaPaneBindings(
    args.paneIdsBySessionAndBinding,
    args.sessionName,
    args.graph.project.id,
    liveSnapshot
  )
  const binding = orcaPaneBinding(args.identity.projectId, args.identity.leafId)
  return args.paneIdsBySessionAndBinding.get(paneBindingMapKey(args.sessionName, binding)) ?? null
}

function syntheticSpawnTab(
  tabId: string,
  worktreeId: string,
  existingTabs: readonly TerminalTab[]
): TerminalTab {
  const title = nextOrcaTerminalTitle(existingTabs)
  return {
    id: tabId,
    ptyId: null,
    worktreeId,
    title,
    defaultTitle: title,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

function desiredLeafBindings(
  projectId: string,
  graph: HerdrProjectHostGraph | undefined
): Set<string> {
  const bindings = new Set<string>()
  if (!graph) {
    return bindings
  }
  for (const worktree of graph.worktrees) {
    for (const tab of graph.tabsByWorktreeId[worktree.id] ?? []) {
      const root = graph.layoutsByTabId[tab.id]?.root
      if (!root) {
        continue
      }
      for (const leafId of collectLeafIds(root)) {
        bindings.add(orcaPaneBinding(projectId, leafId))
      }
    }
  }
  return bindings
}

async function claimMaterializedPane(
  args: {
    transport: HerdrHostTransport
    sessionName: string
    project: Project
    leafId: string
    paneIdsBySessionAndBinding: Map<string, string>
  },
  pane: HerdrSessionSnapshot['panes'][number],
  snapshot: HerdrSessionSnapshot
): Promise<string | null> {
  const binding = orcaPaneBinding(args.project.id, args.leafId)
  const staleToken = pane.tokens?.[ORCA_BINDING_TOKEN]
  if (staleToken !== undefined && staleToken !== binding) {
    await reportPaneTokens(args.transport, args.sessionName, pane.id, {
      [ORCA_BINDING_TOKEN]: null
    })
  }
  const claimed = await claimOrcaPaneBinding(
    args.transport,
    args.sessionName,
    args.project.id,
    args.leafId,
    pane,
    snapshot
  )
  if (!claimed) {
    return null
  }
  args.paneIdsBySessionAndBinding.set(paneBindingMapKey(args.sessionName, binding), pane.id)
  return pane.id
}
