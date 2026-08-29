import { firstTerminalLeafId } from '../../../../shared/horca/herdr-session-identity'
import type {
  TerminalLayoutSnapshot,
  TerminalPaneLayoutNode,
  TerminalTab
} from '../../../../shared/terminal-tab-types'
import type { Project } from '../../../../shared/project-types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { Worktree } from '../../../../shared/worktree/types'
import { basename, normalize } from 'node:path'
import {
  claimOrcaPaneBinding,
  findUniqueHerdrMatch,
  ORCA_BINDING_TOKEN,
  orcaWorkspaceBinding,
  reportOrcaWorkspaceBinding
} from './herdr-binding-metadata'
import type {
  HerdrHostTransport,
  HerdrPane,
  HerdrSessionSnapshot,
  HerdrTab,
  HerdrWorkspace
} from './herdr-runtime-contract'
import { HerdrRuntimeError, unwrapHerdrResponse } from './herdr-runtime-contract'
import { orcaTabTitle, syncHerdrTabLabel } from './herdr-tab-layout'

export type HerdrWorktreeDescriptor = Pick<
  Worktree,
  'id' | 'instanceId' | 'path' | 'displayName'
> & {
  repoPath?: string
}

export type HerdrProjectHostGraph = {
  hostId?: ExecutionHostId
  project: Project
  worktrees: HerdrWorktreeDescriptor[]
  tabsByWorktreeId: Record<string, TerminalTab[]>
  layoutsByTabId: Record<string, TerminalLayoutSnapshot>
  persistedPaneIdsByLeafId?: Record<string, string>
  persistPaneId?: (binding: {
    worktreeId: string
    tabId: string
    leafId: string
    paneId: string
  }) => void
}

export function isLinkedHerdrWorktree(worktree: HerdrWorktreeDescriptor): boolean {
  if (!worktree.repoPath) {
    return false
  }
  return normalize(worktree.path) !== normalize(worktree.repoPath)
}

type OpenedStockWorktree = {
  workspace: HerdrWorkspace
  tab: HerdrTab
  root_pane: HerdrPane
  already_open: boolean
}

export async function ensureStockHerdrWorkspace(
  transport: HerdrHostTransport,
  sessionName: string,
  projectId: string,
  worktree: HerdrWorktreeDescriptor,
  firstTab: TerminalTab | undefined,
  firstRoot: TerminalPaneLayoutNode | null,
  snapshot: HerdrSessionSnapshot,
  liveBindings: ReadonlySet<string> = new Set()
): Promise<HerdrWorkspace> {
  const binding = orcaWorkspaceBinding(projectId, worktree)
  const bound = findUniqueHerdrMatch(
    snapshot.workspaces,
    (workspace) => workspace.tokens?.[ORCA_BINDING_TOKEN] === binding,
    'workspace binding'
  )
  if (bound) {
    return bound
  }

  const adoptable = findAdoptableWorkspace(snapshot.workspaces, worktree, liveBindings)
  if (adoptable) {
    await reportOrcaWorkspaceBinding(transport, sessionName, adoptable.workspace_id, binding)
    adoptable.tokens = { ...adoptable.tokens, [ORCA_BINDING_TOKEN]: binding }
    return adoptable
  }

  if (isLinkedHerdrWorktree(worktree)) {
    const opened = await openStockWorktree(
      transport,
      sessionName,
      projectId,
      worktree,
      firstTab,
      firstRoot,
      snapshot
    )
    if (opened) {
      return opened
    }
  }

  const created = unwrapHerdrResponse<{
    workspace: HerdrWorkspace
    tab: HerdrTab
    root_pane: HerdrPane
  }>(
    await transport.request(sessionName, 'workspace.create', {
      cwd: worktree.path || undefined,
      label: worktree.displayName || basename(worktree.path),
      focus: false
    })
  )
  await reportOrcaWorkspaceBinding(transport, sessionName, created.workspace.workspace_id, binding)
  created.workspace.tokens = {
    ...created.workspace.tokens,
    [ORCA_BINDING_TOKEN]: binding
  }
  snapshot.workspaces.push(created.workspace)
  snapshot.tabs.push(created.tab)
  snapshot.panes.push(created.root_pane)

  const firstLeafId = firstTerminalLeafId(firstRoot)
  if (firstTab && firstLeafId) {
    await claimOrcaPaneBinding(
      transport,
      sessionName,
      projectId,
      firstLeafId,
      created.root_pane,
      snapshot
    )
    await syncHerdrTabLabel(transport, sessionName, created.tab, orcaTabTitle(firstTab))
  }
  return created.workspace
}

async function openStockWorktree(
  transport: HerdrHostTransport,
  sessionName: string,
  projectId: string,
  worktree: HerdrWorktreeDescriptor,
  firstTab: TerminalTab | undefined,
  firstRoot: TerminalPaneLayoutNode | null,
  snapshot: HerdrSessionSnapshot
): Promise<HerdrWorkspace | null> {
  let opened: OpenedStockWorktree
  try {
    opened = unwrapHerdrResponse<OpenedStockWorktree>(
      await transport.request(sessionName, 'worktree.open', {
        cwd: worktree.repoPath,
        path: worktree.path,
        label: worktree.displayName || basename(worktree.path),
        focus: false
      })
    )
  } catch (error) {
    if (!(error instanceof HerdrRuntimeError) || error.code !== 'not_git_worktree') {
      throw error
    }
    return null
  }
  const binding = orcaWorkspaceBinding(projectId, worktree)
  const { workspace, tab, root_pane: rootPane, already_open: alreadyOpen } = opened
  await reportOrcaWorkspaceBinding(transport, sessionName, workspace.workspace_id, binding)
  workspace.tokens = { ...workspace.tokens, [ORCA_BINDING_TOKEN]: binding }
  if (alreadyOpen) {
    const existingTab = snapshot.tabs.find((candidate) => candidate.tab_id === tab.tab_id) ?? tab
    if (firstTab) {
      await syncHerdrTabLabel(transport, sessionName, existingTab, orcaTabTitle(firstTab))
    }
    return workspace
  }
  snapshot.workspaces.push(workspace)
  snapshot.tabs.push(tab)
  snapshot.panes.push(rootPane)

  const firstLeafId = firstTerminalLeafId(firstRoot)
  if (firstTab && firstLeafId) {
    await claimOrcaPaneBinding(transport, sessionName, projectId, firstLeafId, rootPane, snapshot)
    await syncHerdrTabLabel(transport, sessionName, tab, orcaTabTitle(firstTab))
  }
  return workspace
}

export async function enrichHerdrWorkspaceCheckouts(
  transport: HerdrHostTransport,
  sessionName: string,
  snapshot: HerdrSessionSnapshot
): Promise<void> {
  for (const workspace of snapshot.workspaces) {
    if (workspace.cwd || workspace.path || workspace.worktree?.checkout_path) {
      continue
    }
    try {
      const details = unwrapHerdrResponse<{ workspace: HerdrWorkspace }>(
        await transport.request(sessionName, 'workspace.get', {
          workspace_id: workspace.workspace_id
        })
      ).workspace
      workspace.cwd = details.cwd ?? workspace.cwd
      workspace.path = details.path ?? workspace.path
      workspace.worktree = details.worktree ?? workspace.worktree
    } catch {
      // Skinny snapshot records stay adoptable by unique label.
    }
  }
}

export function findHerdrWorkspaceForWorktree(
  snapshot: HerdrSessionSnapshot,
  projectId: string,
  worktree: { id: string; path: string; displayName?: string }
): HerdrWorkspace | undefined {
  const binding = orcaWorkspaceBinding(projectId, worktree)
  const bound = snapshot.workspaces.find(
    (workspace) => workspace.tokens?.[ORCA_BINDING_TOKEN] === binding
  )
  if (bound) {
    return bound
  }
  return findAdoptableWorkspace(snapshot.workspaces, worktree) ?? undefined
}

function findAdoptableWorkspace(
  workspaces: HerdrWorkspace[],
  worktree: { path: string; displayName?: string },
  liveBindings: ReadonlySet<string> = new Set()
): HerdrWorkspace | null {
  const unbound = workspaces.filter((workspace) => {
    const token = workspace.tokens?.[ORCA_BINDING_TOKEN]
    return !token || !liveBindings.has(token)
  })
  if (worktree.path) {
    const byCheckout = findUniqueHerdrMatch(
      unbound,
      (workspace) => workspaceMatchesCheckout(workspace, worktree.path),
      `workspace checkout ${worktree.path}`
    )
    if (byCheckout) {
      return byCheckout
    }
  }
  const expectedLabel = worktree.displayName || basename(worktree.path)
  if (unbound.length === 1 && unbound[0].label === expectedLabel) {
    return unbound[0]
  }
  return findUniqueHerdrMatch(
    unbound,
    (workspace) => workspace.label === expectedLabel,
    `workspace label ${expectedLabel}`
  )
}

function workspaceMatchesCheckout(workspace: HerdrWorkspace, checkoutPath: string): boolean {
  const expected = normalize(checkoutPath)
  return [workspace.worktree?.checkout_path, workspace.cwd, workspace.path].some(
    (candidate) => candidate !== undefined && normalize(candidate) === expected
  )
}
