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
import { herdrOptionalCwd } from './herdr-sdk-values'
import type {
  HerdrHostTransport,
  HerdrPane,
  HerdrSessionSnapshot,
  HerdrTab,
  HerdrWorkspace
} from './herdr-runtime-contract'
import { HerdrRuntimeError } from './herdr-runtime-contract'
import { herdrCheckoutPath } from './herdr-sdk-values'
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

export type EnsuredHerdrWorkspace = {
  workspace: HerdrWorkspace
  seedTab?: HerdrTab
  seedPane?: HerdrPane
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
): Promise<EnsuredHerdrWorkspace> {
  const binding = orcaWorkspaceBinding(projectId, worktree)
  const bound = findUniqueHerdrMatch(
    snapshot.workspaces,
    (workspace) => workspace.tokens?.[ORCA_BINDING_TOKEN] === binding,
    'workspace binding'
  )
  if (bound) {
    return { workspace: bound }
  }

  const adoptable = findAdoptableWorkspace(snapshot.workspaces, worktree, liveBindings)
  if (adoptable) {
    await reportOrcaWorkspaceBinding(transport, sessionName, adoptable.id, binding)
    return { workspace: adoptable }
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

  const created = await transport.sdk.run(sessionName, (herdr) =>
    herdr.workspaces.create({
      ...herdrOptionalCwd(worktree.path),
      label: worktree.displayName || basename(worktree.path),
      focus: false
    })
  )
  await reportOrcaWorkspaceBinding(transport, sessionName, created.workspace.id, binding)
  const firstLeafId = firstTerminalLeafId(firstRoot)
  if (firstTab && firstLeafId) {
    await claimOrcaPaneBinding(
      transport,
      sessionName,
      projectId,
      firstLeafId,
      created.rootPane,
      snapshot
    )
    await syncHerdrTabLabel(transport, sessionName, created.tab, orcaTabTitle(firstTab))
  }
  return {
    workspace: created.workspace,
    seedTab: created.tab,
    seedPane: created.rootPane
  }
}

async function openStockWorktree(
  transport: HerdrHostTransport,
  sessionName: string,
  projectId: string,
  worktree: HerdrWorktreeDescriptor,
  firstTab: TerminalTab | undefined,
  firstRoot: TerminalPaneLayoutNode | null,
  snapshot: HerdrSessionSnapshot
): Promise<EnsuredHerdrWorkspace | null> {
  if (!worktree.repoPath) {
    return null
  }
  try {
    const opened = await transport.sdk.run(sessionName, (herdr) =>
      herdr.worktrees.open({
        cwd: worktree.repoPath,
        path: worktree.path,
        label: worktree.displayName || basename(worktree.path),
        focus: false,
        trustRepository: true
      })
    )
    const binding = orcaWorkspaceBinding(projectId, worktree)
    await reportOrcaWorkspaceBinding(transport, sessionName, opened.workspace.id, binding)
    if (opened.alreadyOpen) {
      const existingTab = snapshot.tabs.find((candidate) => candidate.id === opened.tab.id)
      if (firstTab && existingTab) {
        await syncHerdrTabLabel(transport, sessionName, existingTab, orcaTabTitle(firstTab))
      }
      return { workspace: opened.workspace, seedTab: opened.tab, seedPane: opened.rootPane }
    }
    const firstLeafId = firstTerminalLeafId(firstRoot)
    if (firstTab && firstLeafId) {
      await claimOrcaPaneBinding(
        transport,
        sessionName,
        projectId,
        firstLeafId,
        opened.rootPane,
        snapshot
      )
      await syncHerdrTabLabel(transport, sessionName, opened.tab, orcaTabTitle(firstTab))
    }
    return { workspace: opened.workspace, seedTab: opened.tab, seedPane: opened.rootPane }
  } catch (error) {
    if (!(error instanceof HerdrRuntimeError) || error.code !== 'not_git_worktree') {
      throw error
    }
    return null
  }
}

export async function enrichHerdrWorkspaceCheckouts(
  transport: HerdrHostTransport,
  sessionName: string,
  snapshot: HerdrSessionSnapshot
): Promise<void> {
  for (let index = 0; index < snapshot.workspaces.length; index++) {
    const workspace = snapshot.workspaces[index]
    if (!workspace) {
      continue
    }
    try {
      const fresh = await transport.sdk.run(sessionName, (herdr) =>
        herdr.workspaces.get(herdr.ids.workspace(workspace.id))
      )
      snapshot.workspaces[index] = fresh
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

function newestWorkspace(workspaces: readonly HerdrWorkspace[]): HerdrWorkspace | null {
  if (workspaces.length === 0) {
    return null
  }
  return [...workspaces].sort((left, right) => right.id.localeCompare(left.id))[0] ?? null
}

function findAdoptableWorkspace(
  workspaces: readonly HerdrWorkspace[],
  worktree: { path: string; displayName?: string },
  liveBindings: ReadonlySet<string> = new Set()
): HerdrWorkspace | null {
  const unbound = workspaces.filter((workspace) => {
    const token = workspace.tokens?.[ORCA_BINDING_TOKEN]
    return !token || !liveBindings.has(token)
  })
  if (worktree.path) {
    const byCheckout = unbound.filter((workspace) =>
      workspaceMatchesCheckout(workspace, worktree.path)
    )
    const picked = newestWorkspace(byCheckout)
    if (picked) {
      return picked
    }
  }
  const expectedLabel = worktree.displayName || basename(worktree.path)
  return newestWorkspace(unbound.filter((workspace) => workspace.label === expectedLabel))
}

function workspaceMatchesCheckout(workspace: HerdrWorkspace, checkoutPath: string): boolean {
  const expected = normalize(checkoutPath)
  const checkout = herdrCheckoutPath(workspace)
  return checkout !== undefined && normalize(checkout) === expected
}
