import { describe, expect, it, vi } from 'vitest'
import type { Project } from '../../../../shared/project-types'
import { HerdrRuntimeManager } from './herdr-runtime-manager'
import { stockTransport } from './herdr-runtime-manager-test-fixtures'

function project(): Project {
  return {
    id: 'project-1',
    displayName: 'Project',
    badgeColor: '#000',
    sourceRepoIds: ['repo-1'],
    createdAt: 1,
    updatedAt: 1
  }
}

function singleLeafGraph() {
  return {
    project: project(),
    worktrees: [
      {
        id: 'worktree-1',
        instanceId: 'instance-1',
        path: '/repo',
        displayName: 'repo'
      }
    ],
    tabsByWorktreeId: {
      'worktree-1': [
        {
          id: 'tab-1',
          ptyId: null,
          worktreeId: 'worktree-1',
          title: 'Terminal',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1
        }
      ]
    },
    layoutsByTabId: {
      'tab-1': {
        root: { type: 'leaf' as const, leafId: 'leaf-1' },
        activeLeafId: 'leaf-1',
        expandedLeafId: null
      }
    }
  }
}

describe('Herdr workspace dedupe', () => {
  it('does not create a herdr workspace for a sibling worktree with no orca tabs', async () => {
    const host = stockTransport()
    const persist = vi.fn()
    const present = vi.fn()
    const manager = new HerdrRuntimeManager(host.transport, undefined, undefined, {
      persist,
      present
    })

    await manager.reconcileProjectHost({
      ...singleLeafGraph(),
      worktrees: [
        {
          id: 'worktree-1',
          instanceId: 'instance-1',
          path: '/repo/zsh-patina',
          displayName: 'zsh-patina'
        },
        {
          id: 'worktree-main',
          instanceId: 'instance-main',
          path: '/repo',
          displayName: 'zsh-patina'
        }
      ]
    })

    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'workspace.create')
    ).toHaveLength(1)
    expect(present).not.toHaveBeenCalled()
    expect(host.snapshot.workspaces).toHaveLength(1)
  })

  it('reclaims the create-path pane when the binding map is empty', async () => {
    const host = stockTransport()
    const manager = new HerdrRuntimeManager(host.transport)
    await manager.reconcileProjectHost(singleLeafGraph())
    const map = (manager as unknown as { paneIdsBySessionAndBinding: Map<string, string> })
      .paneIdsBySessionAndBinding
    map.clear()

    const paneId = await manager.materializeLeafPane(project(), 'leaf-1', '/repo', {
      id: 'worktree-1',
      path: '/repo',
      displayName: 'repo'
    })

    expect(paneId).toBe('w1:p1')
    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'layout.apply')
    ).toHaveLength(0)
  })

  it('does not mint a sibling herdr tab for a leaf the session does not model', async () => {
    const host = stockTransport()
    const manager = new HerdrRuntimeManager(host.transport)
    await manager.reconcileProjectHost(singleLeafGraph())

    const paneId = await manager.materializeLeafPane(project(), 'existing-leaf', '/repo', {
      id: 'worktree-1',
      path: '/repo',
      displayName: 'repo'
    })

    expect(paneId).toBeNull()
    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'layout.apply')
    ).toHaveLength(0)
  })
})
