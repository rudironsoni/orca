import type {
  TerminalLayoutSnapshot,
  TerminalPaneLayoutNode
} from '../../../../shared/terminal-tab-types'
import type { HerdrProjectHostGraph } from './ensure-herdr-workspace'
import { collectLeafIds, orcaPaneBinding, paneBindingMapKey } from './herdr-binding-metadata'
import type { HerdrPaneLayoutSnapshot, HerdrSessionSnapshot } from './herdr-runtime-contract'
import { isStockHerdrDefaultTabLabel } from './herdr-tab-layout'

export type HerdrOrcaLeafIdentity = {
  worktreeId: string
  tabId: string
  leafId: string
}

export type HerdrOrcaSurfaceAction =
  | { kind: 'rename'; tabId: string; title: string }
  | { kind: 'focus'; tabId: string; worktreeId: string; leafId: string }
  | { kind: 'close'; tabId: string }
  | { kind: 'layout'; tabId: string; layout: TerminalLayoutSnapshot }

export function resolveHerdrPaneIdentities(
  sessionName: string,
  graphs: HerdrProjectHostGraph[],
  paneIdsBySessionAndBinding: Map<string, string>
): Map<string, HerdrOrcaLeafIdentity> {
  const identities = new Map<string, HerdrOrcaLeafIdentity>()
  for (const graph of graphs) {
    for (const worktree of graph.worktrees) {
      for (const tab of graph.tabsByWorktreeId[worktree.id] ?? []) {
        const root = graph.layoutsByTabId[tab.id]?.root
        if (!root) {
          continue
        }
        for (const leafId of collectLeafIds(root)) {
          const paneId = paneIdsBySessionAndBinding.get(
            paneBindingMapKey(sessionName, orcaPaneBinding(graph.project.id, leafId))
          )
          if (paneId) {
            identities.set(paneId, { worktreeId: worktree.id, tabId: tab.id, leafId })
          }
        }
      }
    }
  }
  return identities
}

export function collectHerdrSurfaceActions(
  previous: HerdrSessionSnapshot | null,
  current: HerdrSessionSnapshot,
  identities: Map<string, HerdrOrcaLeafIdentity>
): HerdrOrcaSurfaceAction[] {
  if (!previous) {
    return []
  }
  const actions: HerdrOrcaSurfaceAction[] = []
  const previousTabs = new Map(previous.tabs.map((tab) => [tab.id, tab]))
  const currentTabs = new Map(current.tabs.map((tab) => [tab.id, tab]))

  for (const [, previousTab] of previousTabs) {
    const currentTab = currentTabs.get(previousTab.id)
    const owner = ownerForHerdrTab(previousTab.id, previous.panes, identities)
    if (!owner) {
      continue
    }
    if (!currentTab) {
      actions.push({ kind: 'close', tabId: owner.tabId })
      continue
    }
    if (
      previousTab.label !== currentTab.label &&
      currentTab.label &&
      !isStockHerdrDefaultTabLabel(currentTab.label)
    ) {
      actions.push({ kind: 'rename', tabId: owner.tabId, title: currentTab.label })
    }
  }

  const previousFocus = focusedPaneId(previous)
  const currentFocus = focusedPaneId(current)
  if (currentFocus && currentFocus !== previousFocus) {
    const owner = identities.get(currentFocus)
    if (owner) {
      actions.push({
        kind: 'focus',
        tabId: owner.tabId,
        worktreeId: owner.worktreeId,
        leafId: owner.leafId
      })
    }
  }

  for (const layout of current.layouts) {
    const previousLayout = previous.layouts.find((candidate) => candidate.tabId === layout.tabId)
    if (!previousLayout || sameLayout(previousLayout, layout)) {
      continue
    }
    const owner = ownerForHerdrTab(layout.tabId, current.panes, identities)
    const next = herdrLayoutToOrcaLayout(layout, identities)
    if (owner && next) {
      actions.push({ kind: 'layout', tabId: owner.tabId, layout: next })
    }
  }

  return actions
}

function ownerForHerdrTab(
  herdrTabId: string,
  panes: readonly { id: string; tabId: string }[],
  identities: Map<string, HerdrOrcaLeafIdentity>
): HerdrOrcaLeafIdentity | null {
  for (const pane of panes) {
    if (pane.tabId !== herdrTabId) {
      continue
    }
    const owner = identities.get(pane.id)
    if (owner) {
      return owner
    }
  }
  return null
}

function focusedPaneId(snapshot: HerdrSessionSnapshot): string | null {
  const focused = snapshot.panes.find((pane) => pane.focused)
  if (focused) {
    return focused.id
  }
  for (const layout of snapshot.layouts) {
    if (layout.focusedPaneId) {
      return layout.focusedPaneId
    }
  }
  return null
}

function sameLayout(left: HerdrPaneLayoutSnapshot, right: HerdrPaneLayoutSnapshot): boolean {
  return (
    JSON.stringify(left.panes) === JSON.stringify(right.panes) &&
    JSON.stringify(left.splits) === JSON.stringify(right.splits) &&
    left.focusedPaneId === right.focusedPaneId &&
    left.zoomed === right.zoomed
  )
}

export function herdrLayoutToOrcaLayout(
  layout: HerdrPaneLayoutSnapshot,
  identities: Map<string, HerdrOrcaLeafIdentity>
): TerminalLayoutSnapshot | null {
  const panes = layout.panes.flatMap((pane) => {
    const leafId = identities.get(pane.paneId)?.leafId
    return leafId ? [{ leafId, rect: pane.rect }] : []
  })
  if (panes.length === 0 || panes.length !== layout.panes.length) {
    return null
  }
  const root = herdrPanesToOrcaTree(panes, layout.splits ?? [])
  if (!root) {
    return null
  }
  const firstLeafId = panes[0].leafId
  if (panes.length === 1) {
    return {
      root,
      activeLeafId: identities.get(layout.focusedPaneId)?.leafId ?? firstLeafId,
      expandedLeafId: layout.zoomed
        ? (identities.get(layout.focusedPaneId)?.leafId ?? firstLeafId)
        : null
    }
  }
  return {
    root,
    activeLeafId: identities.get(layout.focusedPaneId)?.leafId ?? firstLeafId,
    expandedLeafId: layout.zoomed ? (identities.get(layout.focusedPaneId)?.leafId ?? null) : null
  }
}

type BoundPane = {
  leafId: string
  rect: { x: number; y: number; width: number; height: number }
}

function herdrPanesToOrcaTree(
  panes: BoundPane[],
  splits: NonNullable<HerdrPaneLayoutSnapshot['splits']>,
  usedSplitIds = new Set<string>()
): TerminalPaneLayoutNode | null {
  if (panes.length === 1) {
    return { type: 'leaf', leafId: panes[0].leafId }
  }
  const candidates = splits
    .filter(
      (split) =>
        !usedSplitIds.has(split.id) && panes.every((pane) => paneCenterInsideRect(pane, split.rect))
    )
    .sort(
      (left, right) => right.rect.width * right.rect.height - left.rect.width * left.rect.height
    )
  for (const split of candidates) {
    const boundary =
      split.direction === 'right'
        ? split.rect.x + split.rect.width * split.ratio
        : split.rect.y + split.rect.height * split.ratio
    const first = panes.filter((pane) => paneCenter(pane, split.direction) <= boundary)
    const second = panes.filter((pane) => paneCenter(pane, split.direction) > boundary)
    if (first.length === 0 || second.length === 0) {
      continue
    }
    const nextUsed = new Set(usedSplitIds).add(split.id)
    const firstNode = herdrPanesToOrcaTree(first, splits, nextUsed)
    const secondNode = herdrPanesToOrcaTree(second, splits, nextUsed)
    if (!firstNode || !secondNode) {
      continue
    }
    return {
      type: 'split',
      direction: split.direction === 'down' ? 'horizontal' : 'vertical',
      ratio: Math.min(0.95, Math.max(0.05, split.ratio)),
      first: firstNode,
      second: secondNode
    }
  }
  return null
}

function paneCenter(pane: BoundPane, direction: 'right' | 'down'): number {
  return direction === 'right'
    ? pane.rect.x + pane.rect.width / 2
    : pane.rect.y + pane.rect.height / 2
}

function paneCenterInsideRect(
  pane: BoundPane,
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  const x = pane.rect.x + pane.rect.width / 2
  const y = pane.rect.y + pane.rect.height / 2
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
}
