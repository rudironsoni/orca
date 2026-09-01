import type { Pane, Tab, Workspace, WorkspaceWorktree } from '@herdr/sdk'
import { Option } from 'effect'

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
