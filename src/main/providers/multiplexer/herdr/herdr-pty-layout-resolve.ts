import type {
  TerminalLayoutSnapshot,
  TerminalPaneLayoutNode
} from '../../../../shared/terminal-tab-types'

function countLeaves(node: TerminalPaneLayoutNode | null): number {
  if (!node) {
    return 0
  }
  if (node.type === 'leaf') {
    return 1
  }
  return countLeaves(node.first) + countLeaves(node.second)
}

function nodeContainsLeaf(node: TerminalPaneLayoutNode | null, leafId: string): boolean {
  if (!node) {
    return false
  }
  if (node.type === 'leaf') {
    return node.leafId === leafId
  }
  return nodeContainsLeaf(node.first, leafId) || nodeContainsLeaf(node.second, leafId)
}

export function resolveHerdrSpawnLayout(
  leafId: string,
  rendererLayout: TerminalLayoutSnapshot | undefined,
  persistedLayout: TerminalLayoutSnapshot | undefined
): TerminalLayoutSnapshot {
  const named: TerminalLayoutSnapshot[] = []
  if (rendererLayout?.root && nodeContainsLeaf(rendererLayout.root, leafId)) {
    named.push(rendererLayout)
  }
  if (persistedLayout?.root && nodeContainsLeaf(persistedLayout.root, leafId)) {
    named.push(persistedLayout)
  }
  if (named.length > 0) {
    return named.reduce((best, candidate) =>
      countLeaves(candidate.root) > countLeaves(best.root) ? candidate : best
    )
  }

  return {
    root: { type: 'leaf', leafId },
    activeLeafId: leafId,
    expandedLeafId: null
  }
}
