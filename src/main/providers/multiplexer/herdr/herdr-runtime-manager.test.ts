import { describe, expect, it, vi } from 'vitest'
import { herdrSessionNameForProject } from '../../../../shared/horca/herdr-session-identity'
import { HerdrRuntimeManager } from './herdr-runtime-manager'
import { ORCA_BINDING_TOKEN, orcaPaneBinding, orcaWorkspaceBinding } from './herdr-binding-metadata'
import {
  eventfulTransport,
  graph,
  graphWithSessionName,
  project,
  singleLeafGraph,
  stockTransport,
  tab
} from './herdr-runtime-manager-test-fixtures'
import { testPane, testTab, testWorkspace } from './herdr-sdk-test-snapshot'

describe('HerdrRuntimeManager stock reconciliation', () => {
  it('creates and tags a split without fork-only methods, then stays idempotent', async () => {
    const host = stockTransport()
    const persistPaneId = vi.fn()
    const manager = new HerdrRuntimeManager(host.transport)
    const projectGraph = { ...graph(), persistPaneId }
    await manager.reconcileProjectHost(projectGraph)
    await manager.reconcileProjectHost(projectGraph)

    expect(host.snapshot.workspaces).toHaveLength(1)
    expect(host.snapshot.panes).toHaveLength(2)
    expect(manager.getPaneId(herdrSessionNameForProject(project()), 'project-1', 'leaf-1')).toBe(
      'w1:p1'
    )
    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'workspace.create')
    ).toHaveLength(1)
    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'pane.split')
    ).toHaveLength(1)
    expect(host.requestMock.mock.calls.map(([, method]) => method)).not.toContain('pane.bind')
    expect(new Set(persistPaneId.mock.calls.map(([binding]) => binding.leafId))).toEqual(
      new Set(['leaf-1', 'leaf-2'])
    )
  })

  it('renames the stock workspace.create tab to the Orca title', async () => {
    const host = stockTransport()
    const manager = new HerdrRuntimeManager(host.transport)
    await manager.reconcileProjectHost({
      ...singleLeafGraph(),
      tabsByWorktreeId: {
        'worktree-1': [{ ...tab(), title: 'Terminal 1' }]
      }
    })

    expect(host.snapshot.tabs).toHaveLength(1)
    expect(host.snapshot.tabs[0]?.label).toBe('Terminal 1')
    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'tab.create')
    ).toHaveLength(0)
    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'layout.apply')
    ).toHaveLength(0)
    const rename = host.requestMock.mock.calls.find(([, method]) => method === 'tab.rename')
    expect(rename?.[2]).toEqual({ tabId: 'w1:t1', label: 'Terminal 1' })
  })

  it('renames the stock worktree.open tab to the Orca title', async () => {
    const host = stockTransport()
    const manager = new HerdrRuntimeManager(host.transport)
    await manager.reconcileProjectHost({
      ...singleLeafGraph(),
      worktrees: [
        {
          id: 'worktree-1',
          instanceId: 'instance-1',
          path: '/repo',
          displayName: 'repo',
          repoPath: '/repo-root'
        }
      ],
      tabsByWorktreeId: {
        'worktree-1': [{ ...tab(), title: 'Terminal 1' }]
      }
    })

    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'worktree.open')
    ).toHaveLength(1)
    expect(host.snapshot.tabs).toHaveLength(1)
    expect(host.snapshot.tabs[0]?.label).toBe('Terminal 1')
    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'tab.create')
    ).toHaveLength(0)
  })

  it('closes an unbound stock leftover tab next to the Orca-owned tab', async () => {
    const worktree = {
      id: 'worktree-1',
      instanceId: 'instance-1',
      path: '/repo',
      displayName: 'repo'
    }
    const host = stockTransport({
      workspaces: [
        {
          workspace_id: 'w1',
          label: 'repo',
          cwd: '/repo'
        }
      ],
      tabs: [
        { tab_id: 'w1:t1', workspace_id: 'w1', label: 'Terminal 1' },
        { tab_id: 'w1:t2', workspace_id: 'w1', label: '1' }
      ],
      panes: [
        { pane_id: 'w1:p1', tab_id: 'w1:t1', workspace_id: 'w1' },
        { pane_id: 'w1:p2', tab_id: 'w1:t2', workspace_id: 'w1' }
      ]
    })
    const manager = new HerdrRuntimeManager(host.transport)
    await manager.reconcileProjectHost({
      ...singleLeafGraph(),
      worktrees: [worktree],
      tabsByWorktreeId: {
        'worktree-1': [{ ...tab(), title: 'Terminal 1' }]
      }
    })

    expect(host.snapshot.tabs.map((candidate) => candidate.label)).toEqual(['Terminal 1'])
    expect(host.requestMock.mock.calls.filter(([, method]) => method === 'tab.close')).toEqual([
      expect.arrayContaining(['tab.close', { tabId: 'w1:t2' }])
    ])
  })

  it('reconciles into the shared Orca session when a sharedName is configured', async () => {
    const host = stockTransport()
    const manager = new HerdrRuntimeManager(host.transport, () => 'orca')
    await manager.reconcileProjectHost(graph())

    expect(host.snapshot.workspaces).toHaveLength(1)
    const sessions = host.requestMock.mock.calls.map(([session]) => session)
    expect(sessions.length).toBeGreaterThan(0)
    expect([...new Set(sessions)]).toEqual(['orca'])
    expect(host.transport.ensureSession).toHaveBeenCalledWith('orca')
  })

  it('lets a per-project override win over the shared session when both are set', async () => {
    const host = stockTransport()
    const manager = new HerdrRuntimeManager(host.transport, () => 'orca')
    await manager.reconcileProjectHost(graphWithSessionName('cdn-repo-session'))

    expect(host.requestMock.mock.calls.map(([session]) => session)).toContain('cdn-repo-session')
    expect(host.requestMock.mock.calls.map(([session]) => session)).not.toContain('orca')
  })

  it('refuses to guess between duplicate stock workspace candidates', async () => {
    const host = stockTransport({
      workspaces: [
        {
          workspace_id: 'w1',
          label: 'repo',
          worktree: { checkout_path: '/repo' }
        },
        {
          workspace_id: 'w2',
          label: 'repo',
          worktree: { checkout_path: '/repo' }
        }
      ]
    })
    const manager = new HerdrRuntimeManager(host.transport)
    await expect(manager.reconcileProjectHost(graph())).rejects.toMatchObject({
      code: 'herdr_binding_ambiguous'
    })
  })

  it('opens a git-backed checkout via stock worktree.open and binds the root pane', async () => {
    const host = stockTransport()
    const manager = new HerdrRuntimeManager(host.transport)
    await manager.reconcileProjectHost(graph('/repo-root'))

    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'worktree.open')
    ).toHaveLength(1)
    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'workspace.create')
    ).toHaveLength(0)
    const openParams = host.requestMock.mock.calls.find(
      ([, method]) => method === 'worktree.open'
    )?.[2] as { cwd: string; path: string; focus: boolean }
    expect(openParams).toMatchObject({ cwd: '/repo-root', path: '/repo', focus: false })
    expect(host.snapshot.workspaces).toHaveLength(1)
    expect(host.snapshot.panes).toHaveLength(2)
    expect(manager.getPaneId(herdrSessionNameForProject(project()), 'project-1', 'leaf-1')).toBe(
      'w1:p1'
    )
    expect(manager.getPaneId(herdrSessionNameForProject(project()), 'project-1', 'leaf-2')).toBe(
      'w1:p2'
    )
  })

  it('adopts a uniquely checked-out workspace even when its orca token is stale', async () => {
    const host = stockTransport({
      workspaces: [
        {
          workspace_id: 'w7',
          label: 'repo',
          worktree: { checkout_path: '/repo' },
          tokens: { [ORCA_BINDING_TOKEN]: 'stale-from-previous-project' }
        }
      ]
    })
    const manager = new HerdrRuntimeManager(host.transport)
    await manager.reconcileProjectHost(graph())

    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'workspace.create')
    ).toHaveLength(0)
    expect(host.snapshot.workspaces).toHaveLength(1)
    expect(host.snapshot.workspaces[0].id).toBe('w7')
    expect(host.snapshot.workspaces[0].tokens?.[ORCA_BINDING_TOKEN]).toBe(
      orcaWorkspaceBinding('project-1', {
        id: 'worktree-1',
        instanceId: 'instance-1',
        path: '/repo',
        displayName: 'repo'
      })
    )
  })

  it('adopts an unbound restored workspace by cwd after a herdr restart', async () => {
    const host = stockTransport({
      workspaces: [{ workspace_id: 'w-restored', label: 'repo', cwd: '/repo' }]
    })
    const manager = new HerdrRuntimeManager(host.transport)
    await manager.reconcileProjectHost(graph())

    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'workspace.create')
    ).toHaveLength(0)
    expect(host.snapshot.workspaces).toHaveLength(1)
    expect(host.snapshot.workspaces[0].id).toBe('w-restored')
    expect(host.snapshot.workspaces[0].tokens?.[ORCA_BINDING_TOKEN]).toBeTruthy()
  })

  it('reclaims restored split panes after tokens drop without rematerializing', async () => {
    const host = stockTransport()
    const manager = new HerdrRuntimeManager(host.transport)
    await manager.reconcileProjectHost(graph())
    const session = herdrSessionNameForProject(project())
    const leaf1 = manager.getPaneId(session, 'project-1', 'leaf-1')
    const leaf2 = manager.getPaneId(session, 'project-1', 'leaf-2')
    expect(leaf1).toBeTruthy()
    expect(leaf2).toBeTruthy()

    host.snapshot.panes = host.snapshot.panes.map((pane) => testPane({ ...pane, tokens: {} }))
    host.snapshot.workspaces = host.snapshot.workspaces.map((workspace) =>
      testWorkspace({ ...workspace, tokens: {} })
    )
    host.requestMock.mockClear()
    await manager.reconcileProjectHost(graph())

    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'workspace.create')
    ).toHaveLength(0)
    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'pane.split')
    ).toHaveLength(0)
    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'layout.apply')
    ).toHaveLength(0)
    expect(manager.getPaneId(session, 'project-1', 'leaf-1')).toBe(leaf1)
    expect(manager.getPaneId(session, 'project-1', 'leaf-2')).toBe(leaf2)
  })

  it('reclaims persisted split panes on a fresh manager without rematerializing', async () => {
    const host = stockTransport({
      workspaces: [{ workspace_id: 'w1', label: 'repo', cwd: '/repo' }],
      tabs: [{ tab_id: 'w1:t1', workspace_id: 'w1', label: 'Terminal' }],
      panes: [
        { pane_id: 'w1:p1', tab_id: 'w1:t1', workspace_id: 'w1' },
        { pane_id: 'w1:p3', tab_id: 'w1:t1', workspace_id: 'w1' }
      ]
    })
    const manager = new HerdrRuntimeManager(host.transport)
    await manager.reconcileProjectHost({
      ...graph(),
      persistedPaneIdsByLeafId: { 'leaf-1': 'w1:p1', 'leaf-2': 'w1:p3' }
    })

    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'workspace.create')
    ).toHaveLength(0)
    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'pane.split')
    ).toHaveLength(0)
    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'layout.apply')
    ).toHaveLength(0)
    expect(manager.getPaneId(herdrSessionNameForProject(project()), 'project-1', 'leaf-1')).toBe(
      'w1:p1'
    )
    expect(manager.getPaneId(herdrSessionNameForProject(project()), 'project-1', 'leaf-2')).toBe(
      'w1:p3'
    )
  })

  it('creates the project root with workspace.create even when repoPath is set', async () => {
    const host = stockTransport()
    const manager = new HerdrRuntimeManager(host.transport)
    await manager.reconcileProjectHost({
      ...graph('/repo'),
      worktrees: [
        {
          id: 'worktree-1',
          instanceId: 'instance-1',
          path: '/repo',
          displayName: 'repo',
          repoPath: '/repo'
        }
      ]
    })

    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'worktree.open')
    ).toHaveLength(0)
    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'workspace.create')
    ).toHaveLength(1)
  })

  it('keeps both project graphs when they share the orca session', async () => {
    const host = stockTransport()
    const manager = new HerdrRuntimeManager(host.transport, () => 'orca')
    const second = {
      ...graph(),
      project: { ...project(), id: 'project-2', displayName: 'Other' },
      worktrees: [
        {
          id: 'worktree-2',
          instanceId: 'instance-2',
          path: '/other',
          displayName: 'other'
        }
      ],
      tabsByWorktreeId: { 'worktree-2': [] },
      layoutsByTabId: {}
    }
    await manager.reconcileProjectHost(graph())
    await manager.reconcileProjectHost(second)

    expect(manager.listSessionNames()).toEqual(['orca'])
    expect(manager.getPaneId('orca', 'project-1', 'leaf-1')).toBe('w1:p1')
  })

  it('adopts an already-open worktree without duplicating the workspace', async () => {
    const host = stockTransport({}, { alreadyOpen: true })
    const manager = new HerdrRuntimeManager(host.transport)
    await manager.reconcileProjectHost(graph('/repo-root'))

    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'worktree.open')
    ).toHaveLength(1)
    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'workspace.create')
    ).toHaveLength(0)
    expect(host.snapshot.workspaces).toHaveLength(1)
  })

  it('falls back to workspace.create when worktree.open reports not_git_worktree', async () => {
    const host = stockTransport({}, { worktreeOpenError: 'not_git_worktree' })
    const manager = new HerdrRuntimeManager(host.transport)
    await manager.reconcileProjectHost(graph('/repo-root'))

    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'worktree.open')
    ).toHaveLength(1)
    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'workspace.create')
    ).toHaveLength(1)
    expect(manager.getPaneId(herdrSessionNameForProject(project()), 'project-1', 'leaf-1')).toBe(
      'w1:p1'
    )
  })

  it('never double-claims a pane binding when layout.apply re-materializes the tab', async () => {
    // Regresses the shape where layout.apply left two live panes with one orca_binding.
    let seq = 1000
    const host = stockTransport()
    const baseRequest = host.requestMock.getMockImplementation()!
    host.requestMock.mockImplementation(
      async (session: string, method: string, params: unknown) => {
        if (method !== 'layout.apply') {
          return baseRequest(session, method, params)
        }
        const workspaceId = (params as { workspaceId?: string }).workspaceId ?? 'w1'
        const tabId = `w1:apply-${++seq}`
        const first = testPane({ id: `w1:p${++seq}`, tabId, workspaceId })
        const second = testPane({ id: `w1:p${++seq}`, tabId, workspaceId })
        host.snapshot.panes.push(first, second)
        host.snapshot.tabs.push(testTab({ id: tabId, workspaceId, label: 'Terminal' }))
        return {
          id: 'layout',
          result: {
            tabId,
            workspaceId,
            root: {
              type: 'split',
              direction: 'right',
              ratio: 0.5,
              first: { type: 'pane', paneId: first.id },
              second: { type: 'pane', paneId: second.id }
            }
          }
        }
      }
    )

    const manager = new HerdrRuntimeManager(host.transport)
    await manager.reconcileProjectHost(graph())
    await manager.reconcileProjectHost(graph())

    const bindings = new Map<string, string>()
    for (const pane of host.snapshot.panes) {
      const token = pane.tokens?.[ORCA_BINDING_TOKEN]
      if (!token) {
        continue
      }
      const owner = bindings.get(token)
      expect(owner).toBeUndefined()
      bindings.set(token, pane.id)
    }
    expect(bindings.size).toBe(2)
    expect(
      manager.getPaneId(herdrSessionNameForProject(project()), 'project-1', 'leaf-1')
    ).not.toBeNull()
    expect(
      manager.getPaneId(herdrSessionNameForProject(project()), 'project-1', 'leaf-2')
    ).not.toBeNull()
  })

  it('reclaims a duplicate stock pane binding without importing extra herdr tabs at session start', async () => {
    const leafId = '9ff5d61c-7a93-445e-8fe9-4783e56808d5'
    const worktree = {
      id: 'worktree-1',
      instanceId: 'instance-1',
      path: '/repo',
      displayName: 'repo'
    }
    const workspaceBinding = orcaWorkspaceBinding('project-1', worktree)
    const paneBinding = orcaPaneBinding('project-1', leafId)
    const host = stockTransport({
      workspaces: [
        {
          workspace_id: 'w7',
          label: 'repo',
          tokens: { [ORCA_BINDING_TOKEN]: workspaceBinding },
          worktree: { checkout_path: '/repo' }
        }
      ],
      tabs: [
        { tab_id: 'w7:t1', workspace_id: 'w7', label: 'Terminal' },
        { tab_id: 'w7:t2', workspace_id: 'w7', label: 'logs' },
        { tab_id: 'w7:t3', workspace_id: 'w7', label: 'git' }
      ],
      panes: [
        {
          pane_id: 'w7:p1',
          tab_id: 'w7:t1',
          workspace_id: 'w7',
          tokens: { [ORCA_BINDING_TOKEN]: paneBinding }
        },
        {
          pane_id: 'w7:p2',
          tab_id: 'w7:t2',
          workspace_id: 'w7',
          tokens: { [ORCA_BINDING_TOKEN]: paneBinding }
        },
        { pane_id: 'w7:p3', tab_id: 'w7:t3', workspace_id: 'w7' }
      ]
    })
    const persist = vi.fn()
    const present = vi.fn()
    const manager = new HerdrRuntimeManager(host.transport, undefined, undefined, {
      persist,
      present
    })

    await expect(
      manager.reconcileProjectHost({
        ...singleLeafGraph(),
        layoutsByTabId: {
          'tab-1': {
            root: { type: 'leaf', leafId },
            activeLeafId: leafId,
            expandedLeafId: null
          }
        }
      })
    ).resolves.toBeTruthy()

    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'workspace.create')
    ).toHaveLength(0)
    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'tab.create')
    ).toHaveLength(0)
    expect(manager.getPaneId(herdrSessionNameForProject(project()), 'project-1', leafId)).toBe(
      'w7:p1'
    )
    expect(
      host.snapshot.panes.filter((pane) => pane.tokens?.[ORCA_BINDING_TOKEN] === paneBinding)
    ).toHaveLength(1)
    expect(
      host.snapshot.panes.find((pane) => pane.id === 'w7:p2')?.tokens?.[ORCA_BINDING_TOKEN]
    ).not.toBe(paneBinding)
    // Why: at session start Orca's own terminal model is the only pane
    // creator; stray Herdr surfaces arrive later through event-driven
    // reconcile, never through the startup path.
    expect(persist).not.toHaveBeenCalled()
    expect(present).not.toHaveBeenCalled()
  })

  it('adopts a leftover materialized herdr tab instead of minting a second orca tab', async () => {
    const leafId = 'existing-leaf'
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
          tokens: { [ORCA_BINDING_TOKEN]: workspaceBinding }
        }
      ],
      tabs: [
        {
          tab_id: 'w1:t9',
          workspace_id: 'w1',
          label: 'leaf-3542a4f8-ea86-4908-9dbd-40d2fc3bcf4'
        }
      ],
      panes: [{ pane_id: 'w1:p9', tab_id: 'w1:t9', workspace_id: 'w1' }]
    })
    const persist = vi.fn()
    const present = vi.fn()
    const manager = new HerdrRuntimeManager(host.transport, undefined, undefined, {
      persist,
      present
    })

    await manager.reconcileProjectHost({
      ...singleLeafGraph(),
      tabsByWorktreeId: {
        'worktree-1': [{ ...tab(), title: '1' }]
      },
      layoutsByTabId: {
        'tab-1': {
          root: { type: 'leaf', leafId },
          activeLeafId: leafId,
          expandedLeafId: null
        }
      }
    })

    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'tab.create')
    ).toHaveLength(0)
    expect(present).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
    expect(manager.getPaneId(herdrSessionNameForProject(project()), 'project-1', leafId)).toBe(
      'w1:p9'
    )
  })

  it('mints a second herdr tab when the only stock tab is already bound to another leaf', async () => {
    const host = stockTransport()
    const manager = new HerdrRuntimeManager(host.transport)
    await manager.reconcileProjectHost(singleLeafGraph())
    const firstPane = manager.getPaneId(
      herdrSessionNameForProject(project()),
      'project-1',
      'leaf-1'
    )
    expect(firstPane).toBeTruthy()

    const nextLeaf = '5aba23d2-fcee-4887-9bd6-8a3235c3b1d7'
    const paneId = await manager.bindSpawnLeafPane(
      {
        ...singleLeafGraph(),
        tabsByWorktreeId: {
          'worktree-1': [tab(), { ...tab(), id: 'tab-2', title: 'Terminal' }]
        },
        layoutsByTabId: {
          'tab-1': singleLeafGraph().layoutsByTabId['tab-1'],
          'tab-2': {
            root: { type: 'leaf', leafId: nextLeaf },
            activeLeafId: nextLeaf,
            expandedLeafId: null
          }
        }
      },
      {
        projectId: 'project-1',
        worktreeId: 'worktree-1',
        tabId: 'tab-2',
        leafId: nextLeaf
      }
    )

    expect(paneId).toBeTruthy()
    expect(paneId).not.toBe(firstPane)
    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'tab.create')
    ).toHaveLength(1)
    expect(manager.getPaneId(herdrSessionNameForProject(project()), 'project-1', 'leaf-1')).toBe(
      firstPane
    )
  })

  it('adopts the workspace.create tab on spawn instead of minting a UUID-labeled tab', async () => {
    const host = stockTransport()
    const manager = new HerdrRuntimeManager(host.transport)
    const leafId = '24f6c5d7-8592-4fd8-8f4c-363ba048a90b'
    const paneId = await manager.bindSpawnLeafPane(
      {
        ...singleLeafGraph(),
        tabsByWorktreeId: { 'worktree-1': [] },
        layoutsByTabId: {}
      },
      {
        projectId: 'project-1',
        worktreeId: 'worktree-1',
        tabId: leafId,
        leafId
      }
    )

    expect(paneId).toBe('w1:p1')
    expect(host.snapshot.tabs).toHaveLength(1)
    expect(host.snapshot.tabs[0]?.label).not.toBe(leafId)
    expect(
      host.requestMock.mock.calls.filter(([, method]) => method === 'tab.create')
    ).toHaveLength(0)
  })
})

describe('HerdrRuntimeManager event-driven reconcile', () => {
  it('subscribes to events on reconcile and refreshes the snapshot on structural events', async () => {
    const host = eventfulTransport()
    const manager = new HerdrRuntimeManager(host.transport)
    await manager.reconcileProjectHost(graph())
    expect(host.isSubscribed()).toBe(true)

    const snapshotCallsBefore = host.requestMock.mock.calls.filter(
      ([, method]) => method === 'session.snapshot'
    ).length
    host.emit('pane.created')
    await new Promise((resolve) => setTimeout(resolve, 300))
    const snapshotCallsAfter = host.requestMock.mock.calls.filter(
      ([, method]) => method === 'session.snapshot'
    ).length
    expect(snapshotCallsAfter).toBeGreaterThan(snapshotCallsBefore)
  })

  it('notifies pane.exited before the pane leaves the snapshot', async () => {
    const host = eventfulTransport()
    const onPaneExited = vi.fn()
    const manager = new HerdrRuntimeManager(
      host.transport,
      undefined,
      undefined,
      undefined,
      onPaneExited
    )
    await manager.reconcileProjectHost(graph())

    const sessionName = herdrSessionNameForProject(project())
    host.emit('pane.exited', { paneId: 'w1:p1' })
    expect(onPaneExited).toHaveBeenCalledWith(sessionName, 'w1:p1')
  })

  it('ignores non-structural events', async () => {
    const host = eventfulTransport()
    const manager = new HerdrRuntimeManager(host.transport)
    await manager.reconcileProjectHost(graph())

    const snapshotCallsBefore = host.requestMock.mock.calls.filter(
      ([, method]) => method === 'session.snapshot'
    ).length
    host.emit('badge_changed')
    await new Promise((resolve) => setTimeout(resolve, 300))
    const snapshotCallsAfter = host.requestMock.mock.calls.filter(
      ([, method]) => method === 'session.snapshot'
    ).length
    expect(snapshotCallsAfter).toBe(snapshotCallsBefore)
  })

  it('unsubscribes and disconnects on dispose', async () => {
    const host = eventfulTransport()
    const manager = new HerdrRuntimeManager(host.transport)
    await manager.reconcileProjectHost(graph())
    expect(host.isSubscribed()).toBe(true)
    manager.dispose()
    expect(host.isSubscribed()).toBe(false)
    expect(host.disconnectSpy).toHaveBeenCalled()
  })

  it('renames the Orca tab when a later snapshot changes the Herdr tab label', async () => {
    const host = eventfulTransport()
    const presentAction = vi.fn()
    const manager = new HerdrRuntimeManager(host.transport, undefined, undefined, {
      persist: vi.fn(),
      presentAction
    })
    await manager.reconcileProjectHost(graph())
    expect(host.snapshot.tabs[0]).toBeTruthy()
    const renamed = structuredClone(host.snapshot)
    renamed.tabs[0] = { ...renamed.tabs[0], label: 'renamed-from-tui' }
    const baseRequest = host.requestMock.getMockImplementation()!
    host.requestMock.mockImplementation(async (session, method, params) => {
      if (method === 'session.snapshot') {
        return { id: 'snapshot', result: { snapshot: structuredClone(renamed) } }
      }
      return baseRequest(session, method, params)
    })
    host.emit('tab.renamed')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(presentAction).toHaveBeenCalledWith({
      kind: 'rename',
      tabId: 'tab-1',
      title: 'renamed-from-tui'
    })
  })
})
