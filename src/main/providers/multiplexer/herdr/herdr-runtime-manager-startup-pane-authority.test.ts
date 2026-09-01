import { describe, expect, it, vi } from 'vitest'
import { HerdrRuntimeManager } from './herdr-runtime-manager'
import { ORCA_BINDING_TOKEN, orcaPaneBinding, orcaWorkspaceBinding } from './herdr-binding-metadata'
import {
  eventfulTransport,
  project,
  singleLeafGraph,
  stockTransport
} from './herdr-runtime-manager-test-fixtures'
import { testPane } from './herdr-sdk-test-snapshot'

describe('HerdrRuntimeManager startup pane authority', () => {
  it('does not import an unbound sibling pane at session start', async () => {
    const host = stockTransport()
    const persist = vi.fn()
    const present = vi.fn()
    const manager = new HerdrRuntimeManager(host.transport, undefined, undefined, {
      persist,
      present
    })
    await manager.reconcileProjectHost(singleLeafGraph())

    const workspace = host.snapshot.workspaces[0]
    const tab = host.snapshot.tabs[0]
    expect(workspace).toBeTruthy()
    expect(tab).toBeTruthy()
    host.snapshot.panes.push(
      testPane({
        id: 'w1:p-imported',
        tabId: tab.id,
        workspaceId: workspace.id
      })
    )

    await manager.reconcileProjectHost(singleLeafGraph())
    expect(persist).not.toHaveBeenCalled()
    expect(present).not.toHaveBeenCalled()
  })
  it('reclaims a pane whose stale orca binding instead of minting a second herdr tab', async () => {
    const worktree = {
      id: 'worktree-1',
      instanceId: 'instance-1',
      path: '/repo',
      displayName: 'repo'
    }
    const workspaceBinding = orcaWorkspaceBinding('project-1', worktree)
    const host = stockTransport({
      workspaces: [
        {
          workspace_id: 'w1',
          label: 'repo',
          tokens: { [ORCA_BINDING_TOKEN]: workspaceBinding },
          worktree: { checkout_path: '/repo' }
        }
      ],
      tabs: [
        { tab_id: 'w1:t1', workspace_id: 'w1', label: 'Terminal' },
        { tab_id: 'w1:t2', workspace_id: 'w1', label: '1' }
      ],
      panes: [
        { pane_id: 'w1:p0', tab_id: 'w1:t1', workspace_id: 'w1' },
        {
          pane_id: 'w1:p1',
          tab_id: 'w1:t2',
          workspace_id: 'w1',
          tokens: { [ORCA_BINDING_TOKEN]: 'a'.repeat(64) }
        }
      ]
    })
    const manager = new HerdrRuntimeManager(host.transport)
    await manager.reconcileProjectHost(singleLeafGraph())

    const paneId = await manager.materializeLeafPane(project(), 'new-leaf', '/repo', worktree)

    expect(paneId).toBe('w1:p1')
    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'layout.apply')
    ).toHaveLength(0)
    expect(host.snapshot.panes.find((pane) => pane.id === 'w1:p1')?.tokens).toEqual({
      [ORCA_BINDING_TOKEN]: orcaPaneBinding('project-1', 'new-leaf')
    })
  })
  it('imports unbound surfaces created in the live Herdr session through event reconcile', async () => {
    const host = eventfulTransport()
    const persist = vi.fn()
    const present = vi.fn()
    const manager = new HerdrRuntimeManager(host.transport, undefined, undefined, {
      persist,
      present
    })
    await manager.reconcileProjectHost(singleLeafGraph())
    expect(persist).not.toHaveBeenCalled()
    expect(present).not.toHaveBeenCalled()

    const workspace = host.snapshot.workspaces[0]
    const tab = host.snapshot.tabs[0]
    expect(workspace).toBeTruthy()
    expect(tab).toBeTruthy()
    host.snapshot.panes.push(
      testPane({
        id: 'w1:p-imported',
        tabId: tab.id,
        workspaceId: workspace.id
      })
    )

    host.emit('pane.created', {})
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(persist).toHaveBeenCalledTimes(1)
    expect(present).toHaveBeenCalledTimes(1)
    expect(persist.mock.calls[0][0]).toMatchObject({
      paneId: 'w1:p-imported',
      tabId: 'tab-1',
      splitFromLeafId: 'leaf-1'
    })
    expect(present.mock.calls[0][0]).toEqual(persist.mock.calls[0][0])
  })
})
