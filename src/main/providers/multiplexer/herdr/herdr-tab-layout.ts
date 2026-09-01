import type { TerminalPaneLayoutNode, TerminalTab } from '../../../../shared/terminal-tab-types'
import { firstTerminalLeafId } from '../../../../shared/horca/herdr-session-identity'
import type { HerdrHostTransport, HerdrSessionSnapshot, HerdrTab } from './herdr-runtime-contract'
import { HerdrRuntimeError } from './herdr-runtime-contract'
import { closeHerdrTab, renameHerdrTab } from './herdr-sdk-ops'
import {
  claimOrcaPaneBinding,
  collectLeafIds,
  findUniqueHerdrMatch,
  ORCA_BINDING_TOKEN,
  orcaPaneBinding,
  reclaimExclusiveOrcaPaneBinding,
  restoreOrcaPaneBindings
} from './herdr-binding-metadata'
import { applyTabLayout, clearPaneBindings, ensureTabSplits } from './herdr-tab-layout-apply'
export {
  applyTabLayout,
  collectHerdrPaneIds,
  ensureTabSplits,
  terminalLayoutToHerdrLayout
} from './herdr-tab-layout-apply'

export function orcaTabTitle(tab: { title: string; customTitle?: string | null }): string {
  return tab.customTitle ?? tab.title
}

function tabBoundToOtherLeaf(
  snapshot: HerdrSessionSnapshot,
  tabId: string,
  rootBinding: string
): boolean {
  return snapshot.panes.some(
    (pane) =>
      pane.tabId === tabId &&
      pane.tokens?.[ORCA_BINDING_TOKEN] !== undefined &&
      pane.tokens[ORCA_BINDING_TOKEN] !== rootBinding
  )
}

export function isStockHerdrDefaultTabLabel(label: string | undefined): boolean {
  if (!label) {
    return false
  }
  return label === '1' || label === 'Terminal' || /^leaf-[0-9a-f-]{8,}$/i.test(label)
}

export async function syncHerdrTabLabel(
  transport: HerdrHostTransport,
  sessionName: string,
  herdrTab: HerdrTab,
  title: string
): Promise<void> {
  if (!title || herdrTab.label === title) {
    return
  }
  await renameHerdrTab(transport, sessionName, herdrTab.id, title)
}

export async function closeUnboundStockHerdrTabs(
  transport: HerdrHostTransport,
  sessionName: string,
  workspaceId: string,
  snapshot: HerdrSessionSnapshot
): Promise<void> {
  const boundTabIds = new Set(
    snapshot.panes
      .filter((pane) => pane.workspaceId === workspaceId && pane.tokens?.[ORCA_BINDING_TOKEN])
      .map((pane) => pane.tabId)
  )
  if (boundTabIds.size === 0) {
    return
  }
  for (const tab of snapshot.tabs.filter((candidate) => candidate.workspaceId === workspaceId)) {
    if (boundTabIds.has(tab.id) || !isStockHerdrDefaultTabLabel(tab.label)) {
      continue
    }
    await closeHerdrTab(transport, sessionName, tab.id)
  }
}

function hintedSplitIsLive(
  root: TerminalPaneLayoutNode,
  workspaceId: string,
  snapshot: HerdrSessionSnapshot,
  persistedPaneIds: Record<string, string>
): boolean {
  return collectLeafIds(root).every((leafId) => {
    const paneId = persistedPaneIds[leafId]
    return Boolean(
      paneId &&
      snapshot.panes.some((pane) => pane.id === paneId && pane.workspaceId === workspaceId)
    )
  })
}

// Ensure the tab layout exists in herdr, either via layout.apply or pane.split replay.
// Returns void; throws on unrecoverable errors.
export async function ensureTabLayout(
  transport: HerdrHostTransport,
  sessionName: string,
  projectId: string,
  workspaceId: string,
  tab: TerminalTab,
  root: TerminalPaneLayoutNode,
  snapshot: HerdrSessionSnapshot,
  persistedPaneIds: Record<string, string>
): Promise<void> {
  const rootLeafId = firstTerminalLeafId(root)
  if (!rootLeafId) {
    return
  }
  const rootBinding = orcaPaneBinding(projectId, rootLeafId)
  let rootPane = await reclaimExclusiveOrcaPaneBinding(
    transport,
    sessionName,
    snapshot,
    rootBinding,
    {
      preferredPaneId: persistedPaneIds[rootLeafId],
      workspaceId
    }
  )
  const hintedPane = collectLeafIds(root)
    .map((leafId) => persistedPaneIds[leafId])
    .filter((paneId): paneId is string => Boolean(paneId))
    .map((paneId) => snapshot.panes.find((pane) => pane.id === paneId))
    .find((pane) => pane?.workspaceId === workspaceId)
  let herdrTab = rootPane
    ? snapshot.tabs.find((candidate) => candidate.id === rootPane?.tabId)
    : snapshot.tabs.find((candidate) => candidate.id === hintedPane?.tabId)

  if (!herdrTab) {
    const expectedLabel = tab.customTitle ?? tab.title
    herdrTab =
      findUniqueHerdrMatch(
        snapshot.tabs,
        (candidate) => candidate.workspaceId === workspaceId && candidate.label === expectedLabel,
        `tab label ${expectedLabel}`
      ) ?? undefined
    if (herdrTab && tabBoundToOtherLeaf(snapshot, herdrTab.id, rootBinding)) {
      herdrTab = undefined
    }
    if (herdrTab) {
      const untaggedPanes = snapshot.panes.filter(
        (pane) => pane.tabId === herdrTab?.id && !pane.tokens?.[ORCA_BINDING_TOKEN]
      )
      rootPane = untaggedPanes.length === 1 ? untaggedPanes[0] : null
    }
  }

  // Why: materializeLeafPane used to leave one tab labeled leaf-<id>. Orca
  // persists title "1", so label match fails and tab.create would duplicate.
  // A tab already bound to another leaf is not leftover — mint a new tab.
  if (!herdrTab) {
    const workspaceTabs = snapshot.tabs.filter((candidate) => candidate.workspaceId === workspaceId)
    if (workspaceTabs.length === 1) {
      const only = workspaceTabs[0]
      if (!tabBoundToOtherLeaf(snapshot, only.id, rootBinding)) {
        herdrTab = only
      }
    }
  }

  if (herdrTab && !rootPane) {
    await restoreOrcaPaneBindings(
      transport,
      sessionName,
      projectId,
      root,
      herdrTab.id,
      snapshot,
      persistedPaneIds
    )
    rootPane =
      snapshot.panes.find((pane) => pane.tokens?.[ORCA_BINDING_TOKEN] === rootBinding) ?? null
  }

  if (herdrTab && !rootPane) {
    // Why: a tab whose panes all carry stale leaf tokens from earlier runs has
    // no untagged pane to adopt. Reclaim the tab's first pane and move the
    // binding to it; the daemon enforces single-owner tokens so the stale
    // holder drops the key.
    const tabPane = snapshot.panes.find((pane) => pane.tabId === herdrTab?.id)
    if (tabPane) {
      await clearPaneBindings(
        transport,
        sessionName,
        snapshot.panes.filter((pane) => pane.tabId === herdrTab?.id)
      )
      await claimOrcaPaneBinding(transport, sessionName, projectId, rootLeafId, tabPane, snapshot)
      rootPane = tabPane
    }
  }

  if (!herdrTab) {
    const created = await transport.sdk.run(sessionName, (herdr) =>
      herdr.tabs.create({
        workspaceId,
        cwd: tab.startupCwd,
        label: tab.customTitle ?? tab.title,
        focus: false
      })
    )
    herdrTab = created.tab
    rootPane = created.rootPane
  }

  if (!rootPane) {
    throw new HerdrRuntimeError(
      'herdr_binding_ambiguous',
      `Cannot identify a root pane for stock Herdr tab ${herdrTab.id}`
    )
  }
  if (rootPane.tokens?.[ORCA_BINDING_TOKEN] !== rootBinding) {
    await claimOrcaPaneBinding(transport, sessionName, projectId, rootLeafId, rootPane, snapshot)
  }
  await syncHerdrTabLabel(transport, sessionName, herdrTab, orcaTabTitle(tab))
  if (root.type === 'leaf') {
    return
  }
  // Why: after `session stop` Herdr restores pane ids but drops tokens.
  // layout.apply rematerializes the split and mints new pane ids.
  if (hintedSplitIsLive(root, workspaceId, snapshot, persistedPaneIds)) {
    await restoreOrcaPaneBindings(
      transport,
      sessionName,
      projectId,
      root,
      herdrTab.id,
      snapshot,
      persistedPaneIds
    )
    return
  }
  // Prefer one layout.apply to materialize the whole tree; fall
  // back to pane.split replay when the server cannot apply it.
  const applied = await applyTabLayout(
    transport,
    sessionName,
    projectId,
    workspaceId,
    tab,
    root,
    snapshot,
    herdrTab.id
  )
  if (applied) {
    Object.assign(persistedPaneIds, Object.fromEntries(applied))
  } else {
    await ensureTabSplits(transport, sessionName, projectId, root, rootPane.id, snapshot)
  }
}
