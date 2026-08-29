import { describe, expect, it } from 'vitest'
import type { Project } from '../../../../shared/project-types'
import { ORCA_BINDING_TOKEN, orcaPaneBinding, orcaWorkspaceBinding } from './herdr-binding-metadata'
import { herdrLayoutToOrcaLayout } from './herdr-orca-surface-actions'
import { collectUnboundHerdrSurfaces } from './herdr-orca-surface-import'
import { decodeHerdrPtyId } from './herdr-pty-types'
import { HERDR_PROTOCOL_VERSION, type HerdrSessionSnapshot } from './herdr-runtime-contract'

const project: Project = {
  id: 'project-1',
  displayName: 'Project',
  badgeColor: '#000',
  sourceRepoIds: ['repo-1'],
  createdAt: 1,
  updatedAt: 1
}

const worktree = { id: 'wt-1', path: '/repo', displayName: 'repo' }

function snapshot(overrides: Partial<HerdrSessionSnapshot> = {}): HerdrSessionSnapshot {
  return {
    version: '0.8.2',
    protocol: HERDR_PROTOCOL_VERSION,
    workspaces: [],
    tabs: [],
    panes: [],
    layouts: [],
    agents: [],
    ...overrides
  }
}

describe('collectUnboundHerdrSurfaces', () => {
  it('imports a Herdr-created tab as a new Orca tab', () => {
    const workspaceBinding = orcaWorkspaceBinding(project.id, worktree)
    const surfaces = collectUnboundHerdrSurfaces(
      'orca',
      {
        hostId: 'ssh:server-1',
        project,
        worktrees: [worktree],
        tabsByWorktreeId: { 'wt-1': [] },
        layoutsByTabId: {}
      },
      snapshot({
        workspaces: [
          { workspace_id: 'w1', label: 'repo', tokens: { [ORCA_BINDING_TOKEN]: workspaceBinding } }
        ],
        tabs: [{ tab_id: 'w1:t2', workspace_id: 'w1', label: 'logs' }],
        panes: [{ pane_id: 'w1:p9', tab_id: 'w1:t2', workspace_id: 'w1', cwd: '/repo' }]
      }),
      new Map()
    )

    expect(surfaces).toHaveLength(1)
    expect(surfaces[0]).toMatchObject({
      worktreeId: 'wt-1',
      paneId: 'w1:p9',
      title: 'logs',
      cwd: '/repo'
    })
    expect(surfaces[0].splitFromLeafId).toBeUndefined()
    expect(surfaces[0].ptyId.startsWith('herdr:')).toBe(true)
    expect(decodeHerdrPtyId(surfaces[0].ptyId)?.hostId).toBe('ssh:server-1')
  })

  it('does not reclaim a Herdr-created pane carrying another live binding', () => {
    const workspaceBinding = orcaWorkspaceBinding(project.id, worktree)
    const staleBinding = orcaPaneBinding(project.id, 'gone-leaf')
    const surfaces = collectUnboundHerdrSurfaces(
      'orca',
      {
        project,
        worktrees: [worktree],
        tabsByWorktreeId: { 'wt-1': [] },
        layoutsByTabId: {}
      },
      snapshot({
        workspaces: [
          { workspace_id: 'w1', label: 'repo', tokens: { [ORCA_BINDING_TOKEN]: workspaceBinding } }
        ],
        tabs: [{ tab_id: 'w1:t2', workspace_id: 'w1', label: 'logs' }],
        panes: [
          {
            pane_id: 'w1:p9',
            tab_id: 'w1:t2',
            workspace_id: 'w1',
            tokens: { [ORCA_BINDING_TOKEN]: staleBinding }
          }
        ]
      }),
      new Map([[`orca:${staleBinding}`, 'w1:p9']])
    )

    expect(surfaces).toEqual([])
  })

  it('imports every pane from an ownerless multi-pane tab', () => {
    const workspaceBinding = orcaWorkspaceBinding(project.id, worktree)
    const surfaces = collectUnboundHerdrSurfaces(
      'orca',
      {
        project,
        worktrees: [worktree],
        tabsByWorktreeId: { 'wt-1': [] },
        layoutsByTabId: {}
      },
      snapshot({
        workspaces: [
          { workspace_id: 'w1', label: 'repo', tokens: { [ORCA_BINDING_TOKEN]: workspaceBinding } }
        ],
        tabs: [{ tab_id: 'w1:t2', workspace_id: 'w1', label: 'logs' }],
        panes: [
          { pane_id: 'w1:p1', tab_id: 'w1:t2', workspace_id: 'w1' },
          { pane_id: 'w1:p2', tab_id: 'w1:t2', workspace_id: 'w1' }
        ]
      }),
      new Map()
    )

    expect(surfaces).toHaveLength(2)
    expect(surfaces.map((surface) => surface.paneId)).toEqual(['w1:p1', 'w1:p2'])
    expect(surfaces[1]).toMatchObject({
      tabId: surfaces[0].tabId,
      splitFromLeafId: surfaces[0].leafId
    })
  })

  it('does not import a materialized leaf tab when the worktree already has an Orca tab', () => {
    const workspaceBinding = orcaWorkspaceBinding(project.id, worktree)
    const surfaces = collectUnboundHerdrSurfaces(
      'orca',
      {
        project,
        worktrees: [worktree],
        tabsByWorktreeId: {
          'wt-1': [
            {
              id: 'tab-1',
              ptyId: null,
              worktreeId: 'wt-1',
              title: '1',
              customTitle: null,
              color: null,
              sortOrder: 0,
              createdAt: 1
            }
          ]
        },
        layoutsByTabId: {
          'tab-1': {
            root: { type: 'leaf', leafId: 'existing' },
            activeLeafId: 'existing',
            expandedLeafId: null
          }
        }
      },
      snapshot({
        workspaces: [
          { workspace_id: 'w1', label: 'repo', tokens: { [ORCA_BINDING_TOKEN]: workspaceBinding } }
        ],
        tabs: [
          {
            tab_id: 'w1:t9',
            workspace_id: 'w1',
            label: 'leaf-3542a4f8-ea86-4908-9dbd-40d2fc3bcf4'
          }
        ],
        panes: [{ pane_id: 'w1:p9', tab_id: 'w1:t9', workspace_id: 'w1' }]
      }),
      new Map()
    )

    expect(surfaces).toEqual([])
  })

  it('does not import a leftover Terminal tab when the worktree already has an Orca tab', () => {
    const workspaceBinding = orcaWorkspaceBinding(project.id, worktree)
    const surfaces = collectUnboundHerdrSurfaces(
      'orca',
      {
        project,
        worktrees: [worktree],
        tabsByWorktreeId: {
          'wt-1': [
            {
              id: 'tab-1',
              ptyId: null,
              worktreeId: 'wt-1',
              title: '1',
              customTitle: null,
              color: null,
              sortOrder: 0,
              createdAt: 1
            }
          ]
        },
        layoutsByTabId: {
          'tab-1': {
            root: { type: 'leaf', leafId: 'existing' },
            activeLeafId: 'existing',
            expandedLeafId: null
          }
        }
      },
      snapshot({
        workspaces: [
          { workspace_id: 'w1', label: 'repo', tokens: { [ORCA_BINDING_TOKEN]: workspaceBinding } }
        ],
        tabs: [
          { tab_id: 'w1:t1', workspace_id: 'w1', label: '1' },
          { tab_id: 'w1:t2', workspace_id: 'w1', label: 'Terminal' }
        ],
        panes: [
          { pane_id: 'w1:p1', tab_id: 'w1:t1', workspace_id: 'w1' },
          { pane_id: 'w1:p2', tab_id: 'w1:t2', workspace_id: 'w1' }
        ]
      }),
      new Map()
    )

    expect(surfaces).toEqual([])
  })

  it('does not mint a second Orca tab when the worktree already owns the only Herdr tab', () => {
    const workspaceBinding = orcaWorkspaceBinding(project.id, worktree)
    const surfaces = collectUnboundHerdrSurfaces(
      'orca',
      {
        project,
        worktrees: [worktree],
        tabsByWorktreeId: {
          'wt-1': [
            {
              id: 'tab-1',
              ptyId: null,
              worktreeId: 'wt-1',
              title: '1',
              customTitle: null,
              color: null,
              sortOrder: 0,
              createdAt: 1
            }
          ]
        },
        layoutsByTabId: {
          'tab-1': {
            root: { type: 'leaf', leafId: 'existing' },
            activeLeafId: 'existing',
            expandedLeafId: null
          }
        }
      },
      snapshot({
        workspaces: [
          { workspace_id: 'w1', label: 'repo', tokens: { [ORCA_BINDING_TOKEN]: workspaceBinding } }
        ],
        tabs: [{ tab_id: 'w1:t1', workspace_id: 'w1', label: 'logs' }],
        panes: [{ pane_id: 'w1:p1', tab_id: 'w1:t1', workspace_id: 'w1' }]
      }),
      new Map()
    )

    expect(surfaces).toEqual([])
  })

  it('imports an unbound sibling pane as a split on the bound Orca tab', () => {
    const workspaceBinding = orcaWorkspaceBinding(project.id, worktree)
    const leafId = 'leaf-1'
    const paneBinding = orcaPaneBinding(project.id, leafId)
    const paneMap = new Map([[`orca:${paneBinding}`, 'w1:p1']])
    const surfaces = collectUnboundHerdrSurfaces(
      'orca',
      {
        project,
        worktrees: [worktree],
        tabsByWorktreeId: {
          'wt-1': [
            {
              id: 'tab-1',
              ptyId: null,
              worktreeId: 'wt-1',
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
            root: { type: 'leaf', leafId },
            activeLeafId: leafId,
            expandedLeafId: null
          }
        }
      },
      snapshot({
        workspaces: [
          { workspace_id: 'w1', label: 'repo', tokens: { [ORCA_BINDING_TOKEN]: workspaceBinding } }
        ],
        tabs: [{ tab_id: 'w1:t1', workspace_id: 'w1', label: 'Terminal' }],
        panes: [
          {
            pane_id: 'w1:p1',
            tab_id: 'w1:t1',
            workspace_id: 'w1',
            tokens: { [ORCA_BINDING_TOKEN]: paneBinding }
          },
          { pane_id: 'w1:p2', tab_id: 'w1:t1', workspace_id: 'w1' }
        ]
      }),
      paneMap
    )

    expect(surfaces).toHaveLength(1)
    expect(surfaces[0]).toMatchObject({
      tabId: 'tab-1',
      paneId: 'w1:p2',
      splitFromLeafId: leafId,
      splitDirection: 'vertical'
    })
  })
})

describe('herdrLayoutToOrcaLayout', () => {
  it('rebuilds a recursive layout with more than two panes', () => {
    expect(
      herdrLayoutToOrcaLayout(
        {
          workspace_id: 'workspace-1',
          tab_id: 'tab-1',
          focused_pane_id: 'pane-1',
          panes: [
            { pane_id: 'pane-1', rect: { x: 0, y: 0, width: 40, height: 20 } },
            { pane_id: 'pane-2', rect: { x: 40, y: 0, width: 40, height: 10 } },
            { pane_id: 'pane-3', rect: { x: 40, y: 10, width: 40, height: 10 } }
          ],
          splits: [
            {
              id: 'split-1',
              direction: 'right',
              ratio: 0.5,
              rect: { x: 0, y: 0, width: 80, height: 20 }
            },
            {
              id: 'split-2',
              direction: 'down',
              ratio: 0.5,
              rect: { x: 40, y: 0, width: 40, height: 20 }
            }
          ],
          zoomed: false
        },
        new Map([
          ['pane-1', { worktreeId: 'wt-1', tabId: 'tab-1', leafId: 'leaf-1' }],
          ['pane-2', { worktreeId: 'wt-1', tabId: 'tab-1', leafId: 'leaf-2' }],
          ['pane-3', { worktreeId: 'wt-1', tabId: 'tab-1', leafId: 'leaf-3' }]
        ])
      )
    ).toEqual({
      root: {
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        first: { type: 'leaf', leafId: 'leaf-1' },
        second: {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.5,
          first: { type: 'leaf', leafId: 'leaf-2' },
          second: { type: 'leaf', leafId: 'leaf-3' }
        }
      },
      activeLeafId: 'leaf-1',
      expandedLeafId: null
    })
  })
})
