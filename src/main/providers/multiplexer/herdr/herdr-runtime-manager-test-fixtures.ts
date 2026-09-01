import type { Project } from '../../../../shared/project-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'

export { eventfulTransport, stockTransport } from './herdr-sdk-test-host'

export function project(): Project {
  return {
    id: 'project-1',
    displayName: 'Project',
    badgeColor: '#000',
    sourceRepoIds: ['repo-1'],
    createdAt: 1,
    updatedAt: 1
  }
}

export function tab(): TerminalTab {
  return {
    id: 'tab-1',
    ptyId: null,
    worktreeId: 'worktree-1',
    title: 'Terminal',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

export function graphWithSessionName(herdrSessionName: string) {
  return { ...graph(), project: { ...project(), herdrSessionName } }
}

export function singleLeafGraph() {
  return {
    project: project(),
    worktrees: [{ id: 'worktree-1', instanceId: 'instance-1', path: '/repo', displayName: 'repo' }],
    tabsByWorktreeId: { 'worktree-1': [tab()] },
    layoutsByTabId: {
      'tab-1': {
        root: { type: 'leaf' as const, leafId: 'leaf-1' },
        activeLeafId: 'leaf-1',
        expandedLeafId: null
      }
    }
  }
}

export function graph(repoPath?: string) {
  return {
    project: project(),
    worktrees: [
      {
        id: 'worktree-1',
        instanceId: 'instance-1',
        path: '/repo',
        displayName: 'repo',
        ...(repoPath ? { repoPath } : {})
      }
    ],
    tabsByWorktreeId: { 'worktree-1': [tab()] },
    layoutsByTabId: {
      'tab-1': {
        root: {
          type: 'split' as const,
          direction: 'vertical' as const,
          ratio: 0.5,
          first: { type: 'leaf' as const, leafId: 'leaf-1' },
          second: { type: 'leaf' as const, leafId: 'leaf-2' }
        },
        activeLeafId: 'leaf-1',
        expandedLeafId: null
      }
    }
  }
}
