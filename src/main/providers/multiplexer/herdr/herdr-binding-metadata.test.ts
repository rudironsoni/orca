import { describe, expect, it } from 'vitest'
import {
  claimOrcaPaneBinding,
  findUniqueHerdrMatch,
  ORCA_BINDING_TOKEN,
  orcaPaneBinding,
  orcaWorkspaceBinding,
  reclaimExclusiveOrcaPaneBinding,
  recoverPaneIdsFromStockLayout,
  restoreOrcaPaneBindings
} from './herdr-binding-metadata'
import { handlerTransport } from './herdr-sdk-test-host'
import { testPane, testSnapshot } from './herdr-sdk-test-snapshot'

describe('stock Herdr metadata bindings', () => {
  it('uses stable token-sized digests for Orca resources', () => {
    const workspace = orcaWorkspaceBinding('project-1', {
      id: 'worktree-1',
      instanceId: 'instance-1',
      path: '/repo',
      displayName: 'repo'
    })
    expect(workspace).toHaveLength(64)
    expect(orcaPaneBinding('project-1', 'leaf-1')).toHaveLength(64)
    expect(workspace).not.toBe(orcaPaneBinding('project-1', 'leaf-1'))
  })

  it('refuses ambiguous adoption candidates', () => {
    expect(() => findUniqueHerdrMatch([1, 2], () => true, 'workspace checkout')).toThrow(
      'Orca will not guess'
    )
  })

  it('recovers pane identities from stock layout geometry after token loss', () => {
    const recovered = recoverPaneIdsFromStockLayout(
      {
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        first: { type: 'leaf', leafId: 'left' },
        second: { type: 'leaf', leafId: 'right' }
      },
      {
        workspaceId: 'w1',
        tabId: 'w1:t1',
        panes: [
          {
            paneId: 'w1:p2',
            rect: { x: 60, y: 0, width: 60, height: 40 }
          },
          {
            paneId: 'w1:p1',
            rect: { x: 0, y: 0, width: 60, height: 40 }
          }
        ]
      }
    )
    expect(Object.fromEntries(recovered ?? [])).toEqual({
      left: 'w1:p1',
      right: 'w1:p2'
    })
  })

  it('rejects layout geometry that does not match the expected split axis', () => {
    const recovered = recoverPaneIdsFromStockLayout(
      {
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        first: { type: 'leaf', leafId: 'left' },
        second: { type: 'leaf', leafId: 'right' }
      },
      {
        workspaceId: 'w1',
        tabId: 'w1:t1',
        panes: [
          {
            paneId: 'w1:p1',
            rect: { x: 0, y: 0, width: 120, height: 20 }
          },
          {
            paneId: 'w1:p2',
            rect: { x: 0, y: 20, width: 120, height: 20 }
          }
        ]
      }
    )
    expect(recovered).toBeNull()
  })

  it('refuses nested split geometry rather than flattening it along the root axis', () => {
    const recovered = recoverPaneIdsFromStockLayout(
      {
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        first: {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.5,
          first: { type: 'leaf', leafId: 'tl' },
          second: { type: 'leaf', leafId: 'bl' }
        },
        second: { type: 'leaf', leafId: 'right' }
      },
      {
        workspaceId: 'w1',
        tabId: 'w1:t1',
        panes: [
          { paneId: 'w1:p1', rect: { x: 0, y: 0, width: 60, height: 20 } },
          { paneId: 'w1:p2', rect: { x: 0, y: 20, width: 60, height: 20 } },
          { paneId: 'w1:p3', rect: { x: 60, y: 0, width: 60, height: 40 } }
        ]
      }
    )
    expect(recovered).toBeNull()
  })

  it('keeps persisted pane IDs when geometry recovery fails instead of dropping all bindings', async () => {
    const root = {
      type: 'split',
      direction: 'vertical',
      ratio: 0.5,
      first: { type: 'leaf', leafId: 'left' },
      second: { type: 'leaf', leafId: 'right' }
    } as const
    const { transport, calls } = handlerTransport({
      'pane.report_metadata': () => undefined
    })
    await restoreOrcaPaneBindings(
      transport,
      'orca-app',
      'project-1',
      root,
      'w1:t1',
      testSnapshot({ panes: [{ id: 'w1:p1', tabId: 'w1:t1' }] }),
      { left: 'w1:p1' }
    )
    expect(calls.filter((call) => call.method === 'pane.report_metadata')).toEqual([
      {
        method: 'pane.report_metadata',
        params: {
          paneId: 'w1:p1',
          source: 'orca',
          tokens: { [ORCA_BINDING_TOKEN]: orcaPaneBinding('project-1', 'left') }
        }
      }
    ])
  })

  it('reclaims a duplicate pane token onto the persisted pane and clears the rest', async () => {
    const binding = orcaPaneBinding('project-1', 'leaf-a')
    const { transport, calls } = handlerTransport({
      'pane.report_metadata': () => undefined
    })
    const snapshot = testSnapshot({
      panes: [
        {
          id: 'w7:p2',
          tabId: 'w7:t2',
          workspaceId: 'w7',
          tokens: { [ORCA_BINDING_TOKEN]: binding }
        },
        {
          id: 'w7:p1',
          tabId: 'w7:t1',
          workspaceId: 'w7',
          tokens: { [ORCA_BINDING_TOKEN]: binding }
        }
      ]
    })
    const winner = await reclaimExclusiveOrcaPaneBinding(transport, 'orca', snapshot, binding, {
      preferredPaneId: 'w7:p1',
      workspaceId: 'w7'
    })
    expect(winner?.id).toBe('w7:p1')
    expect(
      calls
        .filter((call) => call.method === 'pane.report_metadata')
        .map((call) => call.params.paneId)
    ).toEqual(['w7:p2'])
  })

  it('claims a free binding once and refuses to double-claim it on another live pane', async () => {
    const binding = orcaPaneBinding('project-1', 'leaf-a')
    const { transport, calls } = handlerTransport({
      'pane.report_metadata': () => undefined
    })
    const claimed = testSnapshot({
      panes: [
        {
          id: 'w1:p1',
          tabId: 'w1:t1',
          workspaceId: 'w1',
          tokens: { [ORCA_BINDING_TOKEN]: binding }
        }
      ]
    })
    await claimOrcaPaneBinding(
      transport,
      'shared',
      'project-1',
      'leaf-a',
      claimed.panes[0],
      claimed
    )
    await claimOrcaPaneBinding(
      transport,
      'shared',
      'project-1',
      'leaf-a',
      testPane({ id: 'w1:p2', tabId: 'w1:t1', workspaceId: 'w1' }),
      claimed
    )
    expect(calls.map((call) => call.params.paneId)).toEqual([])
  })

  it('lets a pane change its binding to another leaf only when that leaf is unclaimed', async () => {
    const { transport, calls } = handlerTransport({
      'pane.report_metadata': () => undefined
    })
    const pane = testPane({ id: 'w1:p1', tabId: 'w1:t1', workspaceId: 'w1' })
    const snapshot = testSnapshot({ panes: [pane] })
    await claimOrcaPaneBinding(transport, 's', 'project-1', 'leaf-a', pane, snapshot)
    const claimed = testPane({
      id: 'w1:p1',
      tabId: 'w1:t1',
      workspaceId: 'w1',
      tokens: { [ORCA_BINDING_TOKEN]: orcaPaneBinding('project-1', 'leaf-a') }
    })
    await claimOrcaPaneBinding(
      transport,
      's',
      'project-1',
      'leaf-a',
      claimed,
      testSnapshot({ panes: [claimed] })
    )
    await claimOrcaPaneBinding(
      transport,
      's',
      'project-1',
      'leaf-b',
      claimed,
      testSnapshot({ panes: [claimed] })
    )
    expect(calls.map((call) => call.params.paneId)).toEqual(['w1:p1', 'w1:p1'])
  })
})
