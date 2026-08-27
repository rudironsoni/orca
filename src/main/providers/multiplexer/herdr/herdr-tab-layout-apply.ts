import type { TerminalPaneLayoutNode } from '../../../../shared/terminal-tab-types'
import {
  firstTerminalLeafId,
  herdrSplitDirection
} from '../../../../shared/horca/herdr-session-identity'
import type { HerdrHostTransport, HerdrPane, HerdrSessionSnapshot } from './herdr-runtime-contract'
import { unwrapHerdrResponse } from './herdr-runtime-contract'
import {
  claimOrcaPaneBinding,
  collectLeafIds,
  ORCA_BINDING_TOKEN,
  ORCA_METADATA_SOURCE,
  orcaPaneBinding,
  reclaimExclusiveOrcaPaneBinding
} from './herdr-binding-metadata'
import type { LayoutApplyResult, LayoutNode } from './herdr-socket-types'

function tabLabel(tab: { title: string; customTitle?: string | null }): string {
  return tab.customTitle ?? tab.title
}

export function terminalLayoutToHerdrLayout(node: TerminalPaneLayoutNode): LayoutNode {
  if (node.type === 'leaf') {
    return { type: 'pane' }
  }
  return {
    type: 'split',
    direction: herdrSplitDirection(node.direction),
    ratio: node.ratio ?? 0.5,
    first: terminalLayoutToHerdrLayout(node.first),
    second: terminalLayoutToHerdrLayout(node.second)
  }
}

export function collectHerdrPaneIds(node: LayoutNode | undefined, out: string[]): void {
  if (!node) {
    return
  }
  if (node.type === 'pane') {
    if (node.pane_id) {
      out.push(node.pane_id)
    }
    return
  }
  collectHerdrPaneIds(node.first, out)
  collectHerdrPaneIds(node.second, out)
}

export async function applyTabLayout(
  transport: HerdrHostTransport,
  sessionName: string,
  projectId: string,
  workspaceId: string,
  tab: { startupCwd?: string; customTitle?: string | null; title: string },
  root: TerminalPaneLayoutNode,
  snapshot: HerdrSessionSnapshot,
  herdrTabId?: string
): Promise<Map<string, string> | null> {
  let applied: LayoutApplyResult
  try {
    applied = unwrapHerdrResponse<LayoutApplyResult & { root?: LayoutNode }>(
      await transport.request(sessionName, 'layout.apply', {
        workspace_id: workspaceId,
        ...(herdrTabId ? { tab_id: herdrTabId } : {}),
        root: terminalLayoutToHerdrLayout(root),
        tab_label: tabLabel(tab),
        focus: false
      })
    )
  } catch {
    return null
  }
  const layout = (applied as { layout?: { root?: LayoutNode; tab_id?: string } }).layout
  const layoutRoot = layout?.root
  const leafIds = collectLeafIds(root)
  const paneIds: string[] = []
  collectHerdrPaneIds(layoutRoot, paneIds)
  if (leafIds.length !== paneIds.length) {
    return null
  }
  const returnedPaneIds = new Set(paneIds)
  const targetBindings = new Set(leafIds.map((leafId) => orcaPaneBinding(projectId, leafId)))
  await clearPaneBindings(
    transport,
    sessionName,
    snapshot.panes.filter(
      (pane) =>
        !returnedPaneIds.has(pane.pane_id) &&
        targetBindings.has(pane.tokens?.[ORCA_BINDING_TOKEN] ?? '')
    )
  )
  const tabId = layout?.tab_id ?? ''
  const bindings = new Map<string, string>()
  for (let i = 0; i < leafIds.length; i++) {
    const leafId = leafIds[i]
    const paneId = paneIds[i]
    bindings.set(leafId, paneId)
    const existing = snapshot.panes.find((candidate) => candidate.pane_id === paneId)
    const pane =
      existing ?? ({ pane_id: paneId, tab_id: tabId, workspace_id: workspaceId } as HerdrPane)
    await claimOrcaPaneBinding(transport, sessionName, projectId, leafId, pane, snapshot)
    if (!existing) {
      snapshot.panes.push(pane)
    }
  }
  return bindings
}

export async function clearPaneBindings(
  transport: HerdrHostTransport,
  sessionName: string,
  panes: HerdrPane[]
): Promise<void> {
  for (const pane of panes) {
    if (!pane.tokens?.[ORCA_BINDING_TOKEN]) {
      continue
    }
    unwrapHerdrResponse(
      await transport.request(sessionName, 'pane.report_metadata', {
        pane_id: pane.pane_id,
        source: ORCA_METADATA_SOURCE,
        tokens: { [ORCA_BINDING_TOKEN]: null }
      })
    )
    delete pane.tokens[ORCA_BINDING_TOKEN]
  }
}

export async function ensureTabSplits(
  transport: HerdrHostTransport,
  sessionName: string,
  projectId: string,
  node: TerminalPaneLayoutNode,
  firstPaneId: string,
  snapshot: HerdrSessionSnapshot
): Promise<void> {
  if (node.type === 'leaf') {
    return
  }
  const secondLeafId = firstTerminalLeafId(node.second)
  if (!secondLeafId) {
    return
  }
  const binding = orcaPaneBinding(projectId, secondLeafId)
  let secondPane = await reclaimExclusiveOrcaPaneBinding(transport, sessionName, snapshot, binding)
  if (!secondPane) {
    secondPane = unwrapHerdrResponse<{ pane: HerdrPane }>(
      await transport.request(sessionName, 'pane.split', {
        target_pane_id: firstPaneId,
        direction: herdrSplitDirection(node.direction),
        ratio: node.ratio ?? 0.5,
        focus: false
      })
    ).pane
    await claimOrcaPaneBinding(
      transport,
      sessionName,
      projectId,
      secondLeafId,
      secondPane,
      snapshot
    )
    snapshot.panes.push(secondPane)
  }
  await ensureTabSplits(transport, sessionName, projectId, node.first, firstPaneId, snapshot)
  await ensureTabSplits(
    transport,
    sessionName,
    projectId,
    node.second,
    secondPane.pane_id,
    snapshot
  )
}
