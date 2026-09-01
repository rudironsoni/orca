import { isAbsolute } from 'node:path'
import type { Pane, Tab, Workspace, WorkspaceWorktree } from '@herdr/sdk'
import { Option } from 'effect'

/** SDK OptionFromOptionalKey rejects `cwd: undefined`; omit the key unless the path is absolute. */
export function herdrOptionalCwd(
  path: string | undefined
): { cwd: string } | Record<string, never> {
  return path && isAbsolute(path) ? { cwd: path } : {}
}

export function fromOption<A>(value: Option.Option<A>): A | undefined {
  return Option.getOrUndefined(value)
}

export function herdrWorkspaceId(workspace: Pick<Workspace, 'id'>): string {
  return workspace.id
}

export function herdrTabId(tab: Pick<Tab, 'id'>): string {
  return tab.id
}

export function herdrPaneId(pane: Pick<Pane, 'id'>): string {
  return pane.id
}

export function herdrCheckoutPath(workspace: Workspace): string | undefined {
  const worktree = fromOption(workspace.worktree)
  return worktree?.checkoutPath
}

export function herdrWorktreePath(worktree: WorkspaceWorktree): string {
  return worktree.checkoutPath
}
