import { Buffer } from 'node:buffer'
import { vi } from 'vitest'
import type { Project } from '../../../../shared/project-types'
import type {
  HerdrHostTransport,
  HerdrTerminalClosed,
  HerdrTerminalController,
  HerdrTerminalFrame
} from './herdr-runtime-contract'
import { orcaPaneBinding } from './herdr-binding-metadata'
import type { HerdrProjectHostGraph } from './ensure-herdr-workspace'
import { stockTransport } from './herdr-sdk-test-host'

export function transport(closeBeforeFrame = false, failMethod?: string) {
  let latestClosedListeners = new Set<(event: HerdrTerminalClosed) => void>()
  const bindingToken = orcaPaneBinding('project-1', 'leaf-1')
  const host = stockTransport({
    workspaces: [
      {
        id: 'w1',
        label: 'repo',
        tokens: { orca_binding: bindingToken },
        worktree: { checkoutPath: '/repo' }
      }
    ],
    tabs: [{ id: 't1', workspaceId: 'w1', label: 'Terminal' }],
    panes: [
      {
        id: 'p1',
        tabId: 't1',
        workspaceId: 'w1',
        cwd: '/repo',
        tokens: { orca_binding: bindingToken }
      }
    ]
  })
  if (failMethod) {
    const base = host.requestMock.getMockImplementation()!
    host.requestMock.mockImplementation(async (session, method, params) => {
      if (method === failMethod) {
        throw new Error(`${method} failed`)
      }
      return base(session, method, params)
    })
  }
  const transport: HerdrHostTransport = host.transport
  transport.controlTerminal = vi.fn(
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
  return {
    value: transport,
    requestMock: host.requestMock,
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
