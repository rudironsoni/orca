import type { TerminalPaneLayoutNode } from '../terminal-tab-types'
import { DEFAULT_HERDR_SESSION_NAME } from './terminal-backend'

export type HerdrSessionProject = {
  id: string
  herdrSessionName?: string
}

/**
 * Resolves the stock Herdr session for a project.
 *
 * Priority: an explicit per-project override wins; otherwise every project
 * reconciles into the configured shared session or the Horca default.
 */
export function herdrSessionNameForProject(
  project: HerdrSessionProject,
  sharedName?: string
): string {
  if (project.herdrSessionName?.trim()) {
    return project.herdrSessionName.trim()
  }
  if (sharedName?.trim()) {
    return sharedName.trim()
  }
  return DEFAULT_HERDR_SESSION_NAME
}

export function firstTerminalLeafId(root: TerminalPaneLayoutNode | null): string | null {
  if (!root) {
    return null
  }
  return root.type === 'leaf' ? root.leafId : firstTerminalLeafId(root.first)
}

export function herdrSplitDirection(direction: 'vertical' | 'horizontal'): 'right' | 'down' {
  return direction === 'vertical' ? 'right' : 'down'
}
