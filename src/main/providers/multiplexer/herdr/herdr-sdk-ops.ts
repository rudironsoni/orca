import type { HerdrHostTransport } from './herdr-runtime-contract'

const ORCA_METADATA_SOURCE = 'orca'

export function reportPaneTokens(
  transport: HerdrHostTransport,
  sessionName: string,
  paneId: string,
  tokens: Record<string, string | null>
): Promise<void> {
  return transport.sdk.run(sessionName, (herdr) =>
    herdr.panes.reportMetadata(herdr.ids.pane(paneId), {
      source: ORCA_METADATA_SOURCE,
      tokens
    })
  )
}

export function reportWorkspaceTokens(
  transport: HerdrHostTransport,
  sessionName: string,
  workspaceId: string,
  tokens: Record<string, string | null>
): Promise<void> {
  return transport.sdk.run(sessionName, (herdr) =>
    herdr.workspaces.reportMetadata(herdr.ids.workspace(workspaceId), {
      source: ORCA_METADATA_SOURCE,
      tokens
    })
  )
}

export function closeHerdrPane(
  transport: HerdrHostTransport,
  sessionName: string,
  paneId: string
): Promise<void> {
  return transport.sdk.run(sessionName, (herdr) => herdr.panes.close(herdr.ids.pane(paneId)))
}

export function closeHerdrWorkspace(
  transport: HerdrHostTransport,
  sessionName: string,
  workspaceId: string
): Promise<void> {
  return transport.sdk.run(sessionName, (herdr) =>
    herdr.workspaces.close(herdr.ids.workspace(workspaceId))
  )
}

export function closeHerdrTab(
  transport: HerdrHostTransport,
  sessionName: string,
  tabId: string
): Promise<void> {
  return transport.sdk.run(sessionName, (herdr) => herdr.tabs.close(herdr.ids.tab(tabId)))
}

export function renameHerdrTab(
  transport: HerdrHostTransport,
  sessionName: string,
  tabId: string,
  label: string
): Promise<unknown> {
  return transport.sdk.run(sessionName, (herdr) => herdr.tabs.rename(herdr.ids.tab(tabId), label))
}
