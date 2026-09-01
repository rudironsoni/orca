import type { HerdrEvent, IHerdrSdk } from '@herdr/sdk'
import { Effect } from 'effect'
import { vi } from 'vitest'
import type { HerdrHostTransport, HerdrSdkClient } from './herdr-runtime-contract'
import { HerdrRuntimeError } from './herdr-runtime-contract'
import {
  asSessionSnapshot,
  testLayoutDescription,
  testPane,
  testSnapshot,
  testTab,
  testWorkspace,
  type LooseRecord,
  type MutableHerdrSnapshot
} from './herdr-sdk-test-snapshot'

function attempt<A>(run: () => A | Promise<A>) {
  return Effect.tryPromise({ try: async () => await run(), catch: (error) => error })
}

function resultOf(response: unknown): LooseRecord {
  if (response && typeof response === 'object' && 'error' in response) {
    const error = (response as { error?: { code?: string; message?: string } }).error
    throw new HerdrRuntimeError(error?.code ?? 'herdr_request_failed', error?.message ?? 'failed')
  }
  if (response && typeof response === 'object' && 'result' in response) {
    return ((response as { result?: unknown }).result ?? {}) as LooseRecord
  }
  return (response ?? {}) as LooseRecord
}

function patchTokens(
  current: Record<string, string> | undefined,
  patch: Record<string, string | null> | undefined
): Record<string, string> {
  const next = { ...current }
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null) {
      delete next[key]
    } else {
      next[key] = value
    }
  }
  return next
}

export function stockTransport(
  initial?: LooseRecord,
  opts: { alreadyOpen?: boolean; worktreeOpenError?: string } = {}
) {
  const snapshot: MutableHerdrSnapshot = testSnapshot(initial)
  const requestMock = vi.fn(
    async (_session: string, method: string, params: unknown): Promise<unknown> => {
      const input = (params ?? {}) as LooseRecord
      if (method === 'session.snapshot') {
        return { id: 'snapshot', result: { snapshot: asSessionSnapshot(snapshot) } }
      }
      if (method === 'workspace.get') {
        const id = String(input.workspaceId ?? input.workspace_id ?? '')
        return {
          id: 'workspace-get',
          result:
            snapshot.workspaces.find((candidate) => candidate.id === id) ?? testWorkspace({ id })
        }
      }
      if (method === 'workspace.create') {
        const workspace = testWorkspace({ id: 'w1', label: 'repo' })
        const createdTab = testTab({ id: 'w1:t1', workspaceId: 'w1', label: '1' })
        const rootPane = testPane({ id: 'w1:p1', tabId: 'w1:t1', workspaceId: 'w1' })
        snapshot.workspaces.push(workspace)
        snapshot.tabs.push(createdTab)
        snapshot.panes.push(rootPane)
        return { id: 'workspace', result: { workspace, tab: createdTab, rootPane } }
      }
      if (method === 'worktree.open') {
        if (opts.worktreeOpenError) {
          throw new HerdrRuntimeError(opts.worktreeOpenError, opts.worktreeOpenError)
        }
        const path = String(input.path ?? '/repo')
        const workspace = testWorkspace({
          id: 'w1',
          label: 'repo',
          worktree: { checkoutPath: path }
        })
        const createdTab = testTab({ id: 'w1:t1', workspaceId: 'w1', label: '1' })
        const rootPane = testPane({ id: 'w1:p1', tabId: 'w1:t1', workspaceId: 'w1' })
        snapshot.workspaces.push(workspace)
        snapshot.tabs.push(createdTab)
        snapshot.panes.push(rootPane)
        return {
          id: 'worktree',
          result: { workspace, tab: createdTab, rootPane, alreadyOpen: opts.alreadyOpen ?? false }
        }
      }
      if (method === 'tab.create') {
        const createdTab = testTab({
          id: `w1:t-${snapshot.tabs.length + 1}`,
          workspaceId: String(input.workspaceId ?? 'w1'),
          label: String(input.label ?? '1')
        })
        const rootPane = testPane({
          id: `w1:p-${snapshot.panes.length + 1}`,
          tabId: createdTab.id,
          workspaceId: createdTab.workspaceId
        })
        snapshot.tabs.push(createdTab)
        snapshot.panes.push(rootPane)
        return { id: 'tab', result: { tab: createdTab, rootPane } }
      }
      if (method === 'tab.rename') {
        const tabId = String(input.tabId ?? input.tab_id ?? '')
        snapshot.tabs = snapshot.tabs.map((candidate) =>
          candidate.id === tabId
            ? testTab({ ...candidate, label: String(input.label ?? '') })
            : candidate
        )
        return {
          id: 'tab-rename',
          result: snapshot.tabs.find((candidate) => candidate.id === tabId)
        }
      }
      if (method === 'tab.close') {
        const tabId = String(input.tabId ?? input.tab_id ?? '')
        snapshot.tabs = snapshot.tabs.filter((candidate) => candidate.id !== tabId)
        snapshot.panes = snapshot.panes.filter((pane) => pane.tabId !== tabId)
        return { id: 'tab-close', result: undefined }
      }
      if (method === 'pane.split') {
        const pane = testPane({ id: 'w1:p2', tabId: 'w1:t1', workspaceId: 'w1' })
        snapshot.panes.push(pane)
        return { id: 'split', result: pane }
      }
      if (method === 'workspace.report_metadata' || method === 'pane.report_metadata') {
        return applyMetadata(snapshot, method, input)
      }
      if (method === 'pane.get') {
        const paneId = String(input.paneId ?? input.pane_id ?? '')
        return {
          id: 'pane',
          result:
            snapshot.panes.find((pane) => pane.id === paneId) ??
            testPane({ id: paneId, cwd: '/repo' })
        }
      }
      if (method === 'pane.list') {
        return { id: 'list', result: snapshot.panes }
      }
      if (method === 'pane.read') {
        return { id: 'read', result: { text: 'history\nprompt$ ', revision: 7 } }
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
      throw new Error(`Unexpected stock method ${method}`)
    }
  )
  return {
    snapshot,
    requestMock,
    transport: sdkTransport(requestMock)
  }
}

export function handlerTransport(handlers: Record<string, (params: LooseRecord) => unknown>) {
  const calls: { method: string; params: LooseRecord }[] = []
  const requestMock = vi.fn(async (_session: string, method: string, params: unknown) => {
    const input = (params ?? {}) as LooseRecord
    calls.push({ method, params: input })
    const handler = handlers[method]
    if (!handler) {
      throw new Error(`unhandled method ${method}`)
    }
    return { id: 'r', result: handler(input) }
  })
  return { transport: sdkTransport(requestMock), calls, requestMock }
}

function sdkTransport(
  requestMock: (session: string, method: string, params: unknown) => Promise<unknown>
): HerdrHostTransport {
  const sdk: HerdrSdkClient = {
    run: async (sessionName, operation) => {
      const herdr = fakeHerdr(sessionName, requestMock) as unknown as IHerdrSdk
      return (await Effect.runPromise(operation(herdr) as Effect.Effect<unknown>)) as never
    },
    subscribe: () => () => undefined,
    ping: async () => undefined,
    dispose: async () => undefined
  }
  return {
    ensureSession: vi.fn(async () => undefined),
    sdk
  } as HerdrHostTransport
}

function applyMetadata(snapshot: MutableHerdrSnapshot, method: string, input: LooseRecord) {
  const patch = input.tokens as Record<string, string | null> | undefined
  if (method === 'workspace.report_metadata') {
    const id = String(input.workspaceId ?? input.workspace_id ?? '')
    snapshot.workspaces = snapshot.workspaces.map((candidate) =>
      candidate.id === id
        ? testWorkspace({ ...candidate, tokens: patchTokens(candidate.tokens, patch) })
        : candidate
    )
    return { id: 'workspace-metadata', result: undefined }
  }
  const paneId = String(input.paneId ?? input.pane_id ?? '')
  snapshot.panes = snapshot.panes.map((candidate) =>
    candidate.id === paneId
      ? testPane({ ...candidate, tokens: patchTokens(candidate.tokens, patch) })
      : candidate
  )
  return { id: 'pane-metadata', result: undefined }
}

function fakeHerdr(
  sessionName: string,
  requestMock: (session: string, method: string, params: unknown) => Promise<unknown>
) {
  const call = (method: string, params?: unknown) =>
    attempt(async () => resultOf(await requestMock(sessionName, method, params ?? {})))
  const id = (value: string) => value
  return {
    ids: { pane: id, tab: id, workspace: id },
    session: { snapshot: () => call('session.snapshot').pipe(Effect.map((body) => body.snapshot)) },
    workspaces: {
      create: (input: unknown) => call('workspace.create', input),
      get: (workspaceId: string) => call('workspace.get', { workspaceId }),
      reportMetadata: (workspaceId: string, input: object) =>
        call('workspace.report_metadata', { workspaceId, ...input }),
      close: (workspaceId: string) => call('workspace.close', { workspaceId })
    },
    worktrees: { open: (input: unknown) => call('worktree.open', input) },
    tabs: {
      create: (input: unknown) => call('tab.create', input),
      rename: (tabId: string, label: string) => call('tab.rename', { tabId, label }),
      close: (tabId: string) => call('tab.close', { tabId })
    },
    panes: {
      split: (paneId: string, input: object) => call('pane.split', { paneId, ...input }),
      reportMetadata: (paneId: string, input: object) =>
        call('pane.report_metadata', { paneId, ...input }),
      get: (paneId: string) => call('pane.get', { paneId }),
      list: (input?: unknown) => call('pane.list', input),
      close: (paneId: string) => call('pane.close', { paneId }),
      sendText: (paneId: string, text: string) => call('pane.send_text', { paneId, text }),
      sendKeys: (paneId: string, keys: unknown) => call('pane.send_keys', { paneId, keys }),
      read: (paneId: string, input: object) => call('pane.read', { paneId, ...input })
    },
    layouts: {
      apply: (input: unknown) =>
        call('layout.apply', input).pipe(
          Effect.map((body) => testLayoutDescription(body, (input ?? {}) as LooseRecord))
        )
    },
    agents: { start: (input: unknown) => call('agent.start', input) }
  }
}

export function eventfulTransport(initial?: LooseRecord) {
  const base = stockTransport(initial)
  const listeners = new Map<string, (event: HerdrEvent) => void>()
  const sdk: HerdrSdkClient = {
    ...base.transport.sdk,
    subscribe: (sessionName, _specs, listener) => {
      listeners.set(sessionName, listener)
      return () => {
        listeners.delete(sessionName)
      }
    }
  }
  const transport: HerdrHostTransport = {
    ...base.transport,
    sdk,
    disconnect: vi.fn(async () => undefined)
  }
  return {
    ...base,
    transport,
    emit: (event: string, data: LooseRecord = {}, sessionName?: string) => {
      const type = event.includes('.') ? event : event.replaceAll('_', '.')
      const paneId = typeof data.paneId === 'string' ? data.paneId : textOrNull(data.pane_id)
      const payload = { type, ...(paneId ? { paneId } : {}) } as HerdrEvent
      if (sessionName) {
        listeners.get(sessionName)?.(payload)
        return
      }
      for (const listener of listeners.values()) {
        listener(payload)
      }
    },
    isSubscribed: () => listeners.size > 0,
    disconnectSpy: transport.disconnect as ReturnType<typeof vi.fn>
  }
}

function textOrNull(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
