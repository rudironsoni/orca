import { Buffer } from 'node:buffer'
import { vi } from 'vitest'
import type {
  HerdrHostTransport,
  HerdrResponse,
  HerdrTerminalClosed,
  HerdrTerminalController,
  HerdrTerminalFrame
} from './herdr-runtime-contract'
import type { Project } from '../../../../shared/project-types'
import { orcaPaneBinding } from './herdr-binding-metadata'
import type { HerdrProjectHostGraph } from './ensure-herdr-workspace'

export function transport(closeBeforeFrame = false, failMethod?: string) {
  let latestClosedListeners = new Set<(event: HerdrTerminalClosed) => void>()
  const requestMock = vi.fn(
    async (
      _session: string,
      method: string,
      _params?: unknown
    ): Promise<HerdrResponse<unknown>> => {
      if (method === failMethod) {
        throw new Error(`${method} failed`)
      }
      if (method === 'session.snapshot') {
        const bindingToken = orcaPaneBinding('project-1', 'leaf-1')
        return {
          id: 'snapshot',
          result: {
            snapshot: {
              version: '0.7.5',
              protocol: 18,
              workspaces: [
                {
                  workspace_id: 'w1',
                  label: 'repo',
                  tokens: { orca_binding: orcaPaneBinding('project-1', 'leaf-1') },
                  worktree: { checkout_path: '/repo' }
                }
              ],
              tabs: [{ tab_id: 't1', workspace_id: 'w1', label: 'Terminal' }],
              panes: [
                {
                  pane_id: 'p1',
                  tab_id: 't1',
                  workspace_id: 'w1',
                  tokens: { orca_binding: bindingToken }
                }
              ],
              layouts: [],
              agents: []
            }
          }
        }
      }
      if (method === 'workspace.create') {
        return {
          id: 'create',
          result: {
            workspace: { workspace_id: 'w1', label: 'repo' },
            tab: { tab_id: 't1', workspace_id: 'w1', label: 'Terminal' },
            root_pane: { pane_id: 'p1', tab_id: 't1', workspace_id: 'w1' }
          }
        }
      }
      if (method === 'workspace.report_metadata') {
        return { id: 'workspace-metadata', result: { type: 'ok' } }
      }
      if (method === 'pane.report_metadata') {
        return { id: 'pane-metadata', result: { type: 'ok' } }
      }
      if (method === 'tab.rename' || method === 'tab.close') {
        return { id: method, result: { type: 'ok' } }
      }
      if (method === 'pane.read') {
        return {
          id: 'read',
          result: { read: { text: 'history\nprompt$ ', revision: 7 } }
        }
      }
      if (method === 'pane.get') {
        return {
          id: 'pane',
          result: {
            pane: { pane_id: 'p1', tab_id: 't1', workspace_id: 'w1', cwd: '/repo' }
          }
        }
      }
      if (method === 'pane.list') {
        return {
          id: 'list',
          result: { panes: [{ pane_id: 'p1', tab_id: 't1', workspace_id: 'w1' }] }
        }
      }
      if (
        method === 'pane.close' ||
        method === 'workspace.close' ||
        method === 'pane.send_keys' ||
        method === 'pane.send_text' ||
        method === 'agent.start'
      ) {
        return { id: method, result: { type: 'ok' } }
      }
      throw new Error(`unexpected method ${method}`)
    }
  )
  const request: HerdrHostTransport['request'] = async <T>(session, method, params) =>
    (await requestMock(session, method, params)) as HerdrResponse<T>
  const value: HerdrHostTransport = {
    ensureSession: vi.fn(async () => undefined),
    request,
    controlTerminal: vi.fn(
      (
        _session: string,
        _target: string,
        options?: { cols: number; rows: number; observe?: boolean }
      ) => {
        if (options?.observe === true) {
          const frameListeners = new Set<(frame: HerdrTerminalFrame) => void>()
          const closedListeners = new Set<(event: HerdrTerminalClosed) => void>()
          latestClosedListeners = closedListeners
          const observe: HerdrTerminalController = {
            write: vi.fn(),
            resize: vi.fn(),
            release: vi.fn(),
            onFrame: (listener) => {
              frameListeners.add(listener)
              return () => frameListeners.delete(listener)
            },
            onClosed: (listener) => {
              closedListeners.add(listener)
              return () => closedListeners.delete(listener)
            }
          }
          setTimeout(() => {
            if (closeBeforeFrame) {
              for (const listener of closedListeners) {
                listener({ type: 'terminal.closed', reason: 'closed' })
              }
            } else {
              for (const listener of frameListeners) {
                listener({
                  type: 'terminal.frame',
                  seq: 1,
                  encoding: 'ansi',
                  width: 120,
                  height: 40,
                  full: true,
                  bytes: Buffer.from('prompt$ ', 'utf8').toString('base64')
                })
              }
            }
          }, 0)
          return observe
        }
        const pulseFrameListeners = new Set<(frame: HerdrTerminalFrame) => void>()
        const pulse: HerdrTerminalController = {
          write: vi.fn(),
          resize: vi.fn(),
          release: vi.fn(),
          onFrame: (listener) => {
            pulseFrameListeners.add(listener)
            return () => pulseFrameListeners.delete(listener)
          },
          onClosed: () => () => undefined
        }
        setTimeout(() => {
          for (const listener of pulseFrameListeners) {
            listener({
              type: 'terminal.frame',
              seq: 1,
              encoding: 'ansi',
              width: options?.cols ?? 80,
              height: options?.rows ?? 24,
              full: true,
              bytes: ''
            })
          }
        }, 0)
        return pulse
      }
    )
  }
  return {
    value,
    requestMock,
    closeObserve: (reason = 'closed') => {
      for (const listener of latestClosedListeners) {
        listener({ type: 'terminal.closed', reason })
      }
    }
  }
}

export function target(): {
  project: Project
  graph: HerdrProjectHostGraph
  identity: {
    version: 2
    hostId: string
    projectId: string
    worktreeId: string
    tabId: string
    leafId: string
  }
  activateHerdr?: () => Promise<void>
  legacyMigrationWorktreeIds?: string[]
} {
  return {
    project: {
      id: 'project-1',
      displayName: 'Test Project',
      badgeColor: '#000000',
      sourceRepoIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    },
    graph: {
      project: {
        id: 'project-1',
        displayName: 'Test Project',
        badgeColor: '#000000',
        sourceRepoIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      worktrees: [],
      tabsByWorktreeId: {},
      layoutsByTabId: {}
    },
    identity: {
      version: 2,
      hostId: 'local',
      projectId: 'project-1',
      worktreeId: 'repo-1::/repo',
      tabId: 'tab-1',
      leafId: 'leaf-1'
    } as const,
    legacyMigrationWorktreeIds: ['repo-1::/repo']
  }
}
