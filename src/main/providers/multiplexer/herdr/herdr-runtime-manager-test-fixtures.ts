import { vi } from 'vitest'
import type { Project } from '../../../../shared/project-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type {
  HerdrHostTransport,
  HerdrResponse,
  HerdrSessionSnapshot
} from './herdr-runtime-contract'

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
  return {
    ...graph(),
    project: { ...project(), herdrSessionName }
  }
}

export function singleLeafGraph() {
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

export function stockTransport(
  initial?: Partial<HerdrSessionSnapshot>,
  opts: { alreadyOpen?: boolean; worktreeOpenError?: string } = {}
) {
  const snapshot: HerdrSessionSnapshot = {
    version: '0.7.5',
    protocol: 18,
    workspaces: [],
    tabs: [],
    panes: [],
    layouts: [],
    agents: [],
    ...initial
  }
  const requestMock = vi.fn(
    async (_session: string, method: string, params: unknown): Promise<HerdrResponse<unknown>> => {
      if (method === 'session.snapshot') {
        return { id: 'snapshot', result: { snapshot } }
      }
      if (method === 'workspace.get') {
        const id = (params as { workspace_id?: string }).workspace_id
        const workspace = snapshot.workspaces.find((candidate) => candidate.workspace_id === id)
        return { id: 'workspace-get', result: { workspace: workspace ?? { workspace_id: id } } }
      }
      if (method === 'workspace.create') {
        const workspace = { workspace_id: 'w1', label: 'repo' }
        const createdTab = { tab_id: 'w1:t1', workspace_id: 'w1', label: '1' }
        const rootPane = { pane_id: 'w1:p1', tab_id: 'w1:t1', workspace_id: 'w1' }
        return {
          id: 'workspace',
          result: { workspace, tab: createdTab, root_pane: rootPane }
        }
      }
      if (method === 'worktree.open') {
        if (opts.worktreeOpenError) {
          return {
            id: 'worktree',
            error: { code: opts.worktreeOpenError, message: opts.worktreeOpenError }
          }
        }
        const path = (params as { path?: string }).path ?? '/repo'
        const workspace = { workspace_id: 'w1', label: 'repo', worktree: { checkout_path: path } }
        const createdTab = { tab_id: 'w1:t1', workspace_id: 'w1', label: '1' }
        const rootPane = { pane_id: 'w1:p1', tab_id: 'w1:t1', workspace_id: 'w1' }
        return {
          id: 'worktree',
          result: {
            workspace,
            tab: createdTab,
            root_pane: rootPane,
            already_open: opts.alreadyOpen ?? false
          }
        }
      }
      if (method === 'tab.create') {
        const input = params as { workspace_id?: string; label?: string }
        const created = {
          tab_id: `w1:t-${snapshot.tabs.length + 1}`,
          workspace_id: input.workspace_id ?? 'w1',
          label: input.label ?? '1'
        }
        const rootPane = {
          pane_id: `w1:p-${snapshot.panes.length + 1}`,
          tab_id: created.tab_id,
          workspace_id: created.workspace_id
        }
        return {
          id: 'tab',
          result: {
            tab: created,
            root_pane: rootPane
          }
        }
      }
      if (method === 'tab.rename') {
        const input = params as { tab_id: string; label: string }
        const existing = snapshot.tabs.find((candidate) => candidate.tab_id === input.tab_id)
        if (existing) {
          existing.label = input.label
        }
        return { id: 'tab-rename', result: { type: 'ok' } }
      }
      if (method === 'tab.close') {
        const input = params as { tab_id: string }
        snapshot.tabs = snapshot.tabs.filter((candidate) => candidate.tab_id !== input.tab_id)
        snapshot.panes = snapshot.panes.filter((pane) => pane.tab_id !== input.tab_id)
        return { id: 'tab-close', result: { type: 'ok' } }
      }
      if (method === 'pane.split') {
        return {
          id: 'split',
          result: {
            pane: { pane_id: 'w1:p2', tab_id: 'w1:t1', workspace_id: 'w1' }
          }
        }
      }
      if (method === 'workspace.report_metadata') {
        const input = params as {
          workspace_id: string
          tokens: Record<string, string>
        }
        const workspace = snapshot.workspaces.find(
          (candidate) => candidate.workspace_id === input.workspace_id
        )
        if (workspace) {
          workspace.tokens = { ...workspace.tokens, ...input.tokens }
        }
        return { id: 'workspace-metadata', result: { type: 'ok' } }
      }
      if (method === 'pane.report_metadata') {
        const input = params as { pane_id: string; tokens: Record<string, string | null> }
        const pane = snapshot.panes.find((candidate) => candidate.pane_id === input.pane_id)
        if (pane) {
          const tokens = { ...pane.tokens }
          for (const [key, value] of Object.entries(input.tokens ?? {})) {
            if (value === null) {
              delete tokens[key]
            } else {
              tokens[key] = value
            }
          }
          pane.tokens = tokens
        }
        return { id: 'pane-metadata', result: { type: 'ok' } }
      }
      throw new Error(`Unexpected stock method ${method}`)
    }
  )
  const request: HerdrHostTransport['request'] = async <T>(session, method, params) =>
    (await requestMock(session, method, params)) as HerdrResponse<T>
  return {
    snapshot,
    requestMock,
    transport: {
      ensureSession: vi.fn(async () => undefined),
      request
    } satisfies HerdrHostTransport
  }
}

export function eventfulTransport(initial?: Partial<HerdrSessionSnapshot>) {
  const base = stockTransport(initial)
  let listener: ((event: { event: string; data: { type: string } }) => void) | null = null
  const transport: HerdrHostTransport = {
    ...base.transport,
    onEvent: (next) => {
      listener = next
      return () => {
        listener = null
      }
    },
    disconnect: vi.fn(async () => undefined)
  }
  return {
    ...base,
    transport,
    emit: (event: string, data: Record<string, unknown> = {}, sessionName?: string) =>
      listener?.({
        event,
        data: { type: event, ...data },
        ...(sessionName ? { sessionName } : {})
      }),
    isSubscribed: () => listener !== null,
    disconnectSpy: transport.disconnect as ReturnType<typeof vi.fn>
  }
}
