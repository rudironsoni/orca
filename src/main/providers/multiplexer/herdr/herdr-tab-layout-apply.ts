import type { TerminalPaneLayoutNode } from '../../../../shared/terminal-tab-types'
import {
  firstTerminalLeafId,
  herdrSplitDirection
} from '../../../../shared/horca/herdr-session-identity'
import type { LayoutDescription } from '@herdr/sdk'
import type { Option } from 'effect'
import type { HerdrHostTransport, HerdrPane, HerdrSessionSnapshot } from './herdr-runtime-contract'
import { reportPaneTokens } from './herdr-sdk-ops'
import {
  claimOrcaPaneBinding,
  collectLeafIds,
  ORCA_BINDING_TOKEN,
  orcaPaneBinding,
  reclaimExclusiveOrcaPaneBinding
} from './herdr-binding-metadata'
import { fromOption } from './herdr-sdk-values'

type LayoutNodeInput =
  | { type: 'pane'; paneId?: string }
  | {
      type: 'split'
      direction: 'right' | 'down'
      ratio: number
      first: LayoutNodeInput
      second: LayoutNodeInput
    }

function tabLabel(tab: { title: string; customTitle?: string | null }): string {
  return tab.customTitle ?? tab.title
}

export function terminalLayoutToHerdrLayout(node: TerminalPaneLayoutNode): LayoutNodeInput {
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

export function collectHerdrPaneIds(
  node: LayoutDescription['root'] | LayoutNodeInput | undefined,
  out: string[]
): void {
  if (!node) {
    return
  }
  if (node.type === 'pane') {
    const paneId = layoutPaneId(node)
    if (paneId) {
      out.push(paneId)
    }
    return
  }
  collectHerdrPaneIds(node.first, out)
  collectHerdrPaneIds(node.second, out)
}

function layoutPaneId(node: { paneId?: unknown }): string | undefined {
  const raw = node.paneId
  if (typeof raw === 'string') {
    return raw.length > 0 ? raw : undefined
  }
  if (!raw) {
    return undefined
  }
  return fromOption(raw as Option.Option<string>)
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
  let applied: LayoutDescription
  try {
    applied = await transport.sdk.run(sessionName, (herdr) =>
      herdr.layouts.apply({
        workspaceId,
        ...(herdrTabId ? { replaceTabId: herdrTabId } : {}),
        root: terminalLayoutToHerdrLayout(root),
        tabLabel: tabLabel(tab),
        focus: false
      })
    )
  } catch {
    return null
  }
  const layoutRoot = applied.root
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
        !returnedPaneIds.has(pane.id) && targetBindings.has(pane.tokens?.[ORCA_BINDING_TOKEN] ?? '')
    )
  )
  const tabId = applied.tabId
  const bindings = new Map<string, string>()
  for (let i = 0; i < leafIds.length; i++) {
    const leafId = leafIds[i]
    const paneId = paneIds[i]
    bindings.set(leafId, paneId)
    const existing = snapshot.panes.find((candidate) => candidate.id === paneId)
    const pane = existing ?? ({ id: paneId, tabId, workspaceId } as HerdrPane)
    await claimOrcaPaneBinding(transport, sessionName, projectId, leafId, pane, snapshot)
  }
  return bindings
}

export async function clearPaneBindings(
  transport: HerdrHostTransport,
  sessionName: string,
  panes: readonly HerdrPane[]
): Promise<void> {
  for (const pane of panes) {
    if (!pane.tokens?.[ORCA_BINDING_TOKEN]) {
      continue
    }
    await reportPaneTokens(transport, sessionName, pane.id, { [ORCA_BINDING_TOKEN]: null })
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
    secondPane = await transport.sdk.run(sessionName, (herdr) =>
      herdr.panes.split(herdr.ids.pane(firstPaneId), {
        direction: herdrSplitDirection(node.direction),
        ratio: node.ratio ?? 0.5,
        focus: false
      })
    )
    await claimOrcaPaneBinding(
      transport,
      sessionName,
      projectId,
      secondLeafId,
      secondPane,
      snapshot
    )
  }
  await ensureTabSplits(transport, sessionName, projectId, node.first, firstPaneId, snapshot)
  await ensureTabSplits(transport, sessionName, projectId, node.second, secondPane.id, snapshot)
}
