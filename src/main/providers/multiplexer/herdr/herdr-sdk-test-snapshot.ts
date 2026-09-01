import type { LayoutDescription } from '@herdr/sdk'
import { Option } from 'effect'
import type {
  HerdrPane,
  HerdrPaneLayoutSnapshot,
  HerdrSessionSnapshot,
  HerdrTab,
  HerdrWorkspace
} from './herdr-runtime-contract'

export type LooseRecord = Record<string, unknown>

export type MutableHerdrSnapshot = {
  version: string
  protocol: number
  focusedWorkspaceId: HerdrSessionSnapshot['focusedWorkspaceId']
  focusedTabId: HerdrSessionSnapshot['focusedTabId']
  focusedPaneId: HerdrSessionSnapshot['focusedPaneId']
  workspaces: HerdrWorkspace[]
  tabs: HerdrTab[]
  panes: HerdrPane[]
  layouts: HerdrPaneLayoutSnapshot[]
  agents: HerdrSessionSnapshot['agents'] extends readonly (infer T)[] ? T[] : never[]
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function tokens(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') {
    return {}
  }
  return { ...(value as Record<string, string>) }
}

export function testWorkspace(raw: LooseRecord = {}): HerdrWorkspace {
  const id = text(raw.id ?? raw.workspace_id, 'w1')
  return {
    id,
    number: typeof raw.number === 'number' ? raw.number : 1,
    label: text(raw.label, 'repo'),
    focused: raw.focused === true,
    paneCount: typeof raw.paneCount === 'number' ? raw.paneCount : 1,
    tabCount: typeof raw.tabCount === 'number' ? raw.tabCount : 1,
    activeTabId: text(raw.activeTabId ?? raw.active_tab_id, `${id}:t1`),
    agentStatus: 'idle',
    tokens: tokens(raw.tokens),
    worktree: testWorktree(raw.worktree)
  } as HerdrWorkspace
}

function testWorktree(raw: unknown): HerdrWorkspace['worktree'] {
  if (!raw || typeof raw !== 'object') {
    return Option.none()
  }
  const body = raw as LooseRecord
  const checkoutPath = text(body.checkoutPath ?? body.checkout_path)
  if (!checkoutPath) {
    return Option.none()
  }
  return Option.some({
    repoKey: text(body.repoKey ?? body.repo_key, checkoutPath),
    repoName: text(body.repoName ?? body.repo_name, 'repo'),
    repoRoot: text(body.repoRoot ?? body.repo_root, checkoutPath),
    checkoutPath,
    isLinkedWorktree: body.isLinkedWorktree === true || body.is_linked_worktree === true
  }) as HerdrWorkspace['worktree']
}

export function testTab(raw: LooseRecord = {}): HerdrTab {
  return {
    id: text(raw.id ?? raw.tab_id, 'w1:t1'),
    workspaceId: text(raw.workspaceId ?? raw.workspace_id, 'w1'),
    number: typeof raw.number === 'number' ? raw.number : 1,
    label: text(raw.label, '1'),
    focused: raw.focused === true,
    paneCount: typeof raw.paneCount === 'number' ? raw.paneCount : 1,
    agentStatus: 'idle'
  } as HerdrTab
}

export function testPane(raw: LooseRecord = {}): HerdrPane {
  const cwd = text(raw.cwd)
  return {
    id: text(raw.id ?? raw.pane_id, 'w1:p1'),
    terminalId: text(raw.terminalId ?? raw.terminal_id, 'term-1'),
    workspaceId: text(raw.workspaceId ?? raw.workspace_id, 'w1'),
    tabId: text(raw.tabId ?? raw.tab_id, 'w1:t1'),
    focused: raw.focused === true,
    cwd: cwd ? Option.some(cwd) : Option.none(),
    foregroundCwd: Option.none(),
    label: Option.none(),
    agent: Option.none(),
    title: Option.none(),
    terminalTitle: Option.none(),
    terminalTitleStripped: Option.none(),
    displayAgent: Option.none(),
    agentStatus: 'idle',
    stateLabels: {},
    tokens: tokens(raw.tokens),
    agentSession: Option.none(),
    scroll: Option.none(),
    revision: 1
  } as HerdrPane
}

export function testSnapshot(raw: LooseRecord = {}): MutableHerdrSnapshot {
  return {
    version: text(raw.version, '0.8.2'),
    protocol: typeof raw.protocol === 'number' ? raw.protocol : 21,
    focusedWorkspaceId: Option.none(),
    focusedTabId: Option.none(),
    focusedPaneId: Option.none(),
    workspaces: Array.isArray(raw.workspaces)
      ? raw.workspaces.map((item) => testWorkspace(item as LooseRecord))
      : [],
    tabs: Array.isArray(raw.tabs) ? raw.tabs.map((item) => testTab(item as LooseRecord)) : [],
    panes: Array.isArray(raw.panes) ? raw.panes.map((item) => testPane(item as LooseRecord)) : [],
    layouts: Array.isArray(raw.layouts)
      ? raw.layouts.map((item) => testLayout(item as LooseRecord))
      : [],
    agents: Array.isArray(raw.agents) ? (raw.agents as MutableHerdrSnapshot['agents']) : []
  }
}

export function testLayout(raw: LooseRecord = {}): HerdrPaneLayoutSnapshot {
  return {
    workspaceId: text(raw.workspaceId ?? raw.workspace_id, 'w1'),
    tabId: text(raw.tabId ?? raw.tab_id, 'w1:t1'),
    zoomed: raw.zoomed === true,
    area: (raw.area as HerdrPaneLayoutSnapshot['area']) ?? {
      x: 0,
      y: 0,
      width: 120,
      height: 40
    },
    focusedPaneId: text(raw.focusedPaneId ?? raw.focused_pane_id, 'w1:p1'),
    panes: Array.isArray(raw.panes)
      ? raw.panes.map((pane) => {
          const body = pane as LooseRecord
          return {
            paneId: text(body.paneId ?? body.pane_id),
            focused: body.focused === true,
            rect: body.rect as HerdrPaneLayoutSnapshot['panes'][number]['rect']
          }
        })
      : [],
    splits: Array.isArray(raw.splits) ? (raw.splits as HerdrPaneLayoutSnapshot['splits']) : []
  } as unknown as HerdrPaneLayoutSnapshot
}

export function asSessionSnapshot(snapshot: MutableHerdrSnapshot): HerdrSessionSnapshot {
  return snapshot as unknown as HerdrSessionSnapshot
}

export function testLayoutDescription(
  body: LooseRecord,
  input: LooseRecord = {}
): LayoutDescription {
  const nested = body.layout && typeof body.layout === 'object' ? (body.layout as LooseRecord) : {}
  const root = (body.root ?? nested.root ?? { type: 'pane' }) as LooseRecord
  return {
    workspaceId: text(body.workspaceId ?? body.workspace_id ?? input.workspaceId, 'w1'),
    tabId: text(
      body.tabId ?? body.tab_id ?? nested.tab_id ?? nested.tabId ?? input.replaceTabId,
      'w1:t1'
    ),
    zoomed: body.zoomed === true,
    focusedPaneId: text(body.focusedPaneId ?? body.focused_pane_id, 'w1:p1'),
    root: testLayoutNode(root)
  } as LayoutDescription
}

function testLayoutNode(node: LooseRecord): LayoutDescription['root'] {
  if (node.type === 'split') {
    return {
      type: 'split',
      direction: node.direction === 'down' ? 'down' : 'right',
      ratio: typeof node.ratio === 'number' ? node.ratio : 0.5,
      first: testLayoutNode((node.first ?? { type: 'pane' }) as LooseRecord),
      second: testLayoutNode((node.second ?? { type: 'pane' }) as LooseRecord)
    }
  }
  const paneId = text(node.paneId ?? node.pane_id)
  return {
    type: 'pane',
    paneId: paneId ? Option.some(paneId) : Option.none(),
    label: Option.none(),
    cwd: Option.none(),
    command: Option.none(),
    env: Option.none()
  } as LayoutDescription['root']
}
