import { describe, expect, it } from 'vitest'
import type { TerminalPaneLayoutNode } from '../../../../shared/terminal-tab-types'
import { terminalLayoutToHerdrLayout, applyTabLayout, ensureTabLayout } from './herdr-tab-layout'
import { ORCA_BINDING_TOKEN, orcaPaneBinding } from './herdr-binding-metadata'
import { handlerTransport } from './herdr-sdk-test-host'
import { testPane, testSnapshot, testTab } from './herdr-sdk-test-snapshot'

const PROJECT = 'proj'
const WORKSPACE = 'w1'
const SESSION = 'orca-proj'

function makeTransport(handlers: Record<string, (params: Record<string, unknown>) => unknown>) {
  return handlerTransport(handlers)
}

function makeSnapshot() {
  return testSnapshot()
}

describe('terminalLayoutToHerdrLayout', () => {
  it('converts a leaf to a bare pane', () => {
    expect(terminalLayoutToHerdrLayout({ type: 'leaf', leafId: 'l1' })).toEqual({ type: 'pane' })
  })

  it('converts splits recursively, mapping vertical to right and preserving ratio', () => {
    const root: TerminalPaneLayoutNode = {
      type: 'split',
      direction: 'vertical',
      ratio: 0.25,
      first: { type: 'leaf', leafId: 'l1' },
      second: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', leafId: 'l2' },
        second: { type: 'leaf', leafId: 'l3' }
      }
    }
    expect(terminalLayoutToHerdrLayout(root)).toEqual({
      type: 'split',
      direction: 'right',
      ratio: 0.25,
      first: { type: 'pane' },
      second: {
        type: 'split',
        direction: 'down',
        ratio: 0.5,
        first: { type: 'pane' },
        second: { type: 'pane' }
      }
    })
  })
})

describe('applyTabLayout', () => {
  const root: TerminalPaneLayoutNode = {
    type: 'split',
    direction: 'vertical',
    first: { type: 'leaf', leafId: 'l1' },
    second: { type: 'leaf', leafId: 'l2' }
  }
  const tab = { title: 'T', customTitle: null, startupCwd: '/x' }

  it('applies the layout, binds leaves in order, and updates the snapshot', async () => {
    const { transport, calls } = makeTransport({
      'layout.apply': () => ({
        layout: {
          tab_id: 't9',
          workspace_id: WORKSPACE,
          root: {
            type: 'split',
            direction: 'right',
            ratio: 0.5,
            first: { type: 'pane', pane_id: 'w1:p1' },
            second: { type: 'pane', pane_id: 'w1:p2' }
          }
        }
      }),
      'pane.report_metadata': () => ({ ok: true })
    })
    const snapshot = makeSnapshot()
    const bindings = await applyTabLayout(
      transport,
      SESSION,
      PROJECT,
      WORKSPACE,
      tab,
      root,
      snapshot
    )

    expect(bindings).toEqual(
      new Map([
        ['l1', 'w1:p1'],
        ['l2', 'w1:p2']
      ])
    )
    const applyCall = calls.find((call) => call.method === 'layout.apply')
    expect(applyCall?.params.workspaceId).toBe(WORKSPACE)
    expect(applyCall?.params.tabLabel).toBe('T')
    expect(applyCall?.params.focus).toBe(false)
    expect(applyCall?.params).not.toHaveProperty('replaceTabId')
  })

  it('prefers customTitle over title for tab_label', async () => {
    const { transport, calls } = makeTransport({
      'layout.apply': () => ({
        layout: { root: { type: 'pane', pane_id: 'w1:p1' }, tab_id: 't1' }
      }),
      'pane.report_metadata': () => ({ ok: true })
    })
    await applyTabLayout(
      transport,
      SESSION,
      PROJECT,
      WORKSPACE,
      { title: 'T', customTitle: 'Custom', startupCwd: '/x' },
      { type: 'leaf', leafId: 'l1' },
      makeSnapshot()
    )
    expect(calls.find((call) => call.method === 'layout.apply')?.params.tabLabel).toBe('Custom')
  })

  it('uses title for tab_label when customTitle is omitted', async () => {
    const { transport, calls } = makeTransport({
      'layout.apply': () => ({
        layout: { root: { type: 'pane', pane_id: 'w1:p1' }, tab_id: 't1' }
      }),
      'pane.report_metadata': () => ({ ok: true })
    })
    await applyTabLayout(
      transport,
      SESSION,
      PROJECT,
      WORKSPACE,
      { title: 'T', startupCwd: '/x' },
      { type: 'leaf', leafId: 'l1' },
      makeSnapshot()
    )
    expect(calls.find((call) => call.method === 'layout.apply')?.params.tabLabel).toBe('T')
  })

  it('passes the adopted herdr tab_id so layout.apply does not mint a sibling tab', async () => {
    const { transport, calls } = makeTransport({
      'layout.apply': () => ({
        layout: {
          tab_id: 't-existing',
          workspace_id: WORKSPACE,
          root: {
            type: 'split',
            direction: 'right',
            ratio: 0.5,
            first: { type: 'pane', pane_id: 'w1:p1' },
            second: { type: 'pane', pane_id: 'w1:p2' }
          }
        }
      }),
      'pane.report_metadata': () => ({ ok: true })
    })
    await applyTabLayout(
      transport,
      SESSION,
      PROJECT,
      WORKSPACE,
      tab,
      root,
      makeSnapshot(),
      't-existing'
    )
    expect(calls.find((call) => call.method === 'layout.apply')?.params.replaceTabId).toBe(
      't-existing'
    )
  })

  it('returns null when layout.apply fails so the caller falls back to pane.split', async () => {
    const { transport } = makeTransport({})
    const result = await applyTabLayout(
      transport,
      SESSION,
      PROJECT,
      WORKSPACE,
      tab,
      root,
      makeSnapshot()
    )
    expect(result).toBeNull()
  })

  it('returns null when the applied tree does not match the leaf count', async () => {
    const { transport } = makeTransport({
      'layout.apply': () => ({ layout: { root: { type: 'pane', pane_id: 'w1:p1' }, tab_id: 't1' } })
    })
    const result = await applyTabLayout(
      transport,
      SESSION,
      PROJECT,
      WORKSPACE,
      tab,
      root,
      makeSnapshot()
    )
    expect(result).toBeNull()
  })

  it('clears replaced server bindings and persists applied pane ids', async () => {
    const { transport, calls } = makeTransport({
      'layout.apply': () => ({
        layout: {
          tab_id: 't2',
          root: {
            type: 'split',
            direction: 'right',
            first: { type: 'pane', pane_id: 'w1:p3' },
            second: { type: 'pane', pane_id: 'w1:p4' }
          }
        }
      }),
      'pane.report_metadata': () => ({ ok: true })
    })
    const persisted: Record<string, string> = {}
    const snapshot = makeSnapshot()
    snapshot.tabs = [testTab({ id: 't1', workspaceId: WORKSPACE, label: 'T' })]
    snapshot.panes = [
      testPane({
        id: 'w1:p1',
        tabId: 't1',
        workspaceId: WORKSPACE,
        tokens: { [ORCA_BINDING_TOKEN]: orcaPaneBinding(PROJECT, 'l1') }
      }),
      testPane({
        id: 'w1:p2',
        tabId: 't1',
        workspaceId: WORKSPACE,
        tokens: { [ORCA_BINDING_TOKEN]: orcaPaneBinding(PROJECT, 'l2') }
      })
    ]

    await ensureTabLayout(
      transport,
      SESSION,
      PROJECT,
      WORKSPACE,
      {
        ...tab,
        id: 'orca-tab',
        ptyId: null,
        worktreeId: 'wt',
        color: null,
        sortOrder: 0,
        createdAt: 1
      },
      root,
      snapshot,
      persisted
    )

    expect(persisted).toEqual({ l1: 'w1:p3', l2: 'w1:p4' })
    const metadataCalls = calls.filter((call) => call.method === 'pane.report_metadata')
    expect(metadataCalls.slice(0, 2).map((call) => call.params)).toEqual([
      {
        paneId: 'w1:p1',
        source: 'orca',
        tokens: { [ORCA_BINDING_TOKEN]: null }
      },
      {
        paneId: 'w1:p2',
        source: 'orca',
        tokens: { [ORCA_BINDING_TOKEN]: null }
      }
    ])
  })
})
