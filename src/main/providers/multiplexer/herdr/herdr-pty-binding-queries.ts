import type { PaneMoveInputEncoded } from '@herdr/sdk'
import type { PtyProcessInfo, PtyProviderBufferSnapshot } from '../../types'
import type { HerdrAgentStatus, HerdrHostTransport, HerdrPane } from './herdr-runtime-contract'
import type {
  HerdrPaneMoveDestination,
  HerdrPaneMoveResult,
  HerdrPaneSwapOptions,
  HerdrPtyBinding
} from './herdr-pty-types'
import { fromOption } from './herdr-sdk-values'

export type HerdrPaneDetails = HerdrPane

async function getHerdrPane(
  transport: HerdrHostTransport,
  binding: HerdrPtyBinding
): Promise<HerdrPaneDetails> {
  return transport.sdk.run(binding.sessionName, (herdr) =>
    herdr.panes.get(herdr.ids.pane(binding.paneId))
  )
}

export async function getHerdrBindingCwd(binding: HerdrPtyBinding): Promise<string> {
  const pane = await getHerdrPane(binding.transport, binding)
  return fromOption(pane.foregroundCwd) ?? fromOption(pane.cwd) ?? binding.cwd
}

export async function clearHerdrBindingBuffer(binding: HerdrPtyBinding): Promise<void> {
  binding.snapshot = ''
}

export async function herdrBindingHasChildProcesses(binding: HerdrPtyBinding): Promise<boolean> {
  const info = await binding.transport.sdk.run(binding.sessionName, (herdr) =>
    herdr.panes.processInfo(herdr.ids.pane(binding.paneId))
  )
  return (info.foregroundProcesses ?? []).length > 0
}

export async function getHerdrBindingForegroundProcess(
  binding: HerdrPtyBinding
): Promise<string | null> {
  const info = await binding.transport.sdk.run(binding.sessionName, (herdr) =>
    herdr.panes.processInfo(herdr.ids.pane(binding.paneId))
  )
  return (info.foregroundProcesses ?? []).at(-1)?.name ?? null
}

export function herdrBindingProcessSnapshot(binding: HerdrPtyBinding): PtyProcessInfo {
  return {
    id: binding.id,
    terminalHandle: `term_${binding.paneId}`,
    incarnationId: binding.incarnationId,
    cwd: binding.cwd,
    title: 'Herdr',
    worktreeId: binding.identity.worktreeId
  }
}

export async function getHerdrBindingProcessInfo(
  binding: HerdrPtyBinding
): Promise<PtyProcessInfo> {
  const pane = await getHerdrPane(binding.transport, binding)
  return {
    ...herdrBindingProcessSnapshot(binding),
    cwd: fromOption(pane.foregroundCwd) ?? fromOption(pane.cwd) ?? binding.cwd,
    title:
      fromOption(pane.title) ?? fromOption(pane.terminalTitle) ?? fromOption(pane.label) ?? 'Herdr'
  }
}

export async function getHerdrBindingBufferSnapshot(
  binding: HerdrPtyBinding,
  scrollbackRows: number | undefined,
  source: 'visible' | 'recent' | 'recent_unwrapped' | 'detection' = 'recent_unwrapped'
): Promise<PtyProviderBufferSnapshot> {
  const read = await binding.transport.sdk.run(binding.sessionName, (herdr) =>
    herdr.panes.read(herdr.ids.pane(binding.paneId), {
      source,
      lines: scrollbackRows,
      format: 'ansi'
    })
  )
  return {
    data: read.text,
    cols: binding.cols,
    rows: binding.rows,
    cwd: binding.cwd,
    seq: read.revision,
    source: 'headless'
  }
}

export type HerdrBindingAgentState = {
  agent: string | null
  agent_status: HerdrAgentStatus
  interactive_ready?: boolean
  launch_pending?: boolean
  state_labels?: Record<string, string>
  display_agent?: string | null
  name?: string | null
  pane_id: string
}

export async function getHerdrBindingAgentState(
  binding: HerdrPtyBinding
): Promise<HerdrBindingAgentState> {
  const agent = await binding.transport.sdk.run(binding.sessionName, (herdr) =>
    herdr.agents.get({ paneId: binding.paneId })
  )
  return {
    agent: fromOption(agent.agent) ?? null,
    agent_status: agent.status,
    interactive_ready: agent.interactiveReady,
    launch_pending: agent.launchPending,
    state_labels: agent.stateLabels,
    display_agent: fromOption(agent.displayAgent) ?? null,
    name: fromOption(agent.name) ?? null,
    pane_id: binding.paneId
  }
}

export async function waitForHerdrBindingAgent(
  binding: HerdrPtyBinding,
  until: HerdrAgentStatus[],
  timeoutMs: number
): Promise<HerdrBindingAgentState> {
  const agent = await binding.transport.sdk.run(binding.sessionName, (herdr) =>
    herdr.agents.wait({ paneId: binding.paneId }, { until, timeoutMs })
  )
  return {
    agent: fromOption(agent.agent) ?? null,
    agent_status: agent.status,
    pane_id: binding.paneId
  }
}

export async function reportHerdrBindingAgent(
  binding: HerdrPtyBinding,
  agent: string,
  state: HerdrAgentStatus,
  message?: string
): Promise<void> {
  await binding.transport.sdk.run(binding.sessionName, (herdr) =>
    herdr.panes.reportAgent(herdr.ids.pane(binding.paneId), {
      source: 'orca',
      agent,
      state: state === 'done' ? 'idle' : state,
      message
    })
  )
}

const notificationDebounce = new Map<string, number>()
const NOTIFICATION_DEBOUNCE_MS = 30_000

export async function maybeNotifyBlocked(
  binding: HerdrPtyBinding,
  agent: string,
  state: HerdrAgentStatus
): Promise<void> {
  if (state !== 'blocked') {
    return
  }
  const now = Date.now()
  pruneNotificationDebounce(now)
  const key = `${binding.sessionName}:${binding.paneId}`
  const last = notificationDebounce.get(key) ?? 0
  if (now - last < NOTIFICATION_DEBOUNCE_MS) {
    return
  }
  notificationDebounce.set(key, now)
  try {
    await binding.transport.sdk.run(binding.sessionName, (herdr) =>
      herdr.notifications.show({
        title: 'Agent blocked',
        body: `Agent ${agent} is blocked`,
        position: 'bottom-right',
        sound: 'done'
      })
    )
  } catch {}
}

function pruneNotificationDebounce(now: number): void {
  for (const [key, last] of notificationDebounce) {
    if (now - last >= NOTIFICATION_DEBOUNCE_MS) {
      notificationDebounce.delete(key)
    }
  }
}

export async function zoomHerdrBinding(
  binding: HerdrPtyBinding,
  mode: 'toggle' | 'on' | 'off' = 'toggle',
  paneId?: string
): Promise<{ changed: boolean; zoomed: boolean; focused_pane_id: string }> {
  const result = await binding.transport.sdk.run(binding.sessionName, (herdr) =>
    herdr.panes.zoom(herdr.ids.pane(paneId ?? binding.paneId), { mode })
  )
  return {
    changed: result.changed,
    zoomed: result.zoomed,
    focused_pane_id: result.focusedPaneId
  }
}

export async function swapHerdrBinding(
  binding: HerdrPtyBinding,
  params: HerdrPaneSwapOptions
): Promise<{
  changed: boolean
  source_pane_id: string
  target_pane_id: string | null
  focused_pane_id: string
}> {
  const result = await binding.transport.sdk.run(binding.sessionName, (herdr) =>
    herdr.panes.swap(
      params.source_pane_id && params.target_pane_id
        ? { sourcePaneId: params.source_pane_id, targetPaneId: params.target_pane_id }
        : { paneId: binding.paneId, direction: params.direction ?? 'right' }
    )
  )
  return {
    changed: result.changed,
    source_pane_id: result.sourcePaneId,
    target_pane_id: fromOption(result.targetPaneId) ?? null,
    focused_pane_id: result.focusedPaneId
  }
}

export async function moveHerdrBinding(
  binding: HerdrPtyBinding,
  params: {
    destination: HerdrPaneMoveDestination
    focus?: boolean
  }
): Promise<HerdrPaneMoveResult> {
  const result = await binding.transport.sdk.run(binding.sessionName, (herdr) =>
    herdr.panes.move(herdr.ids.pane(binding.paneId), {
      destination: toSdkMoveDestination(params.destination),
      focus: params.focus
    })
  )
  return {
    changed: result.changed,
    pane: result.pane,
    previous_pane_id: result.previousPaneId,
    previous_tab_id: result.previousTabId,
    previous_workspace_id: result.previousWorkspaceId,
    focused_pane_id: result.focusedPaneId,
    created_tab: fromOption(result.createdTab) ?? null,
    created_workspace: fromOption(result.createdWorkspace) ?? null,
    closed_tab_id: fromOption(result.closedTabId) ?? null,
    closed_workspace_id: fromOption(result.closedWorkspaceId) ?? null
  }
}

function toSdkMoveDestination(
  destination: HerdrPaneMoveDestination
): PaneMoveInputEncoded['destination'] {
  if (destination.type === 'tab') {
    return {
      type: 'tab',
      tabId: destination.tab_id,
      split: destination.split,
      targetPaneId: destination.target_pane_id,
      ratio: destination.ratio
    }
  }
  if (destination.type === 'new_tab') {
    return { type: 'new_tab', workspaceId: destination.workspace_id, label: destination.label }
  }
  return { type: 'new_workspace', label: destination.label, tabLabel: destination.tab_label }
}

export async function resizeHerdrBinding(
  binding: HerdrPtyBinding,
  direction: 'left' | 'right' | 'up' | 'down',
  amount?: number,
  paneId?: string
): Promise<{ changed: boolean; pane_id: string; focused_pane_id: string }> {
  const result = await binding.transport.sdk.run(binding.sessionName, (herdr) =>
    herdr.panes.resize(direction, {
      paneId: paneId ?? binding.paneId,
      amount
    })
  )
  return {
    changed: result.changed,
    pane_id: result.paneId,
    focused_pane_id: result.focusedPaneId
  }
}
