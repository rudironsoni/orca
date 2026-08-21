import type { Project } from '../../../../shared/project-types'
import {
  claimOrcaPaneBinding,
  ORCA_BINDING_TOKEN,
  orcaPaneBinding,
  paneBindingMapKey
} from './herdr-binding-metadata'
import { findHerdrWorkspaceForWorktree, type HerdrProjectHostGraph } from './ensure-herdr-workspace'
import { collectHerdrPaneIds } from './herdr-tab-layout'
import type { HerdrHostTransport, HerdrSessionSnapshot } from './herdr-runtime-contract'
import { unwrapHerdrResponse } from './herdr-runtime-contract'
import type { LayoutNode } from './herdr-socket-types'

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
    (pane) => workspace && pane.workspace_id === workspace.workspace_id
  )
  const reusable = workspacePanes.find(
    (pane) => !claimedPaneIds.has(pane.pane_id) && !pane.tokens?.[ORCA_BINDING_TOKEN]
  )
  if (reusable) {
    return claimMaterializedPane(args, reusable, snapshot)
  }
  if (!workspace) {
    return null
  }
  const applied = unwrapHerdrResponse<{
    layout: { root?: LayoutNode }
    workspace_id: string
    tab_id: string
  }>(
    await args.transport.request(args.sessionName, 'layout.apply', {
      workspace_id: workspace.workspace_id,
      tab_label: 'Terminal',
      root: { type: 'pane', cwd: args.cwd },
      focus: false
    })
  )
  const paneIds: string[] = []
  collectHerdrPaneIds(applied.layout?.root, paneIds)
  const paneId = paneIds[0]
  if (!paneId) {
    return null
  }
  const pane = snapshot.panes.find((candidate) => candidate.pane_id === paneId) ?? {
    pane_id: paneId,
    tab_id: applied.tab_id,
    workspace_id: applied.workspace_id
  }
  if (!snapshot.panes.includes(pane)) {
    snapshot.panes.push(pane)
  }
  return claimMaterializedPane(args, pane, snapshot)
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
  await claimOrcaPaneBinding(
    args.transport,
    args.sessionName,
    args.project.id,
    args.leafId,
    pane,
    snapshot
  )
  if (pane.tokens?.[ORCA_BINDING_TOKEN] !== binding) {
    return null
  }
  args.paneIdsBySessionAndBinding.set(paneBindingMapKey(args.sessionName, binding), pane.pane_id)
  return pane.pane_id
}
