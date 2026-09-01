const LEAF_TITLE = /^leaf-[0-9a-f-]{8,}$/i
const UUID_TITLE = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i

export type OrcaTabTitleSource = {
  id?: string
  title: string
  customTitle?: string | null
  defaultTitle?: string
}

function isPlaceholderLabel(raw: string, tabId?: string): boolean {
  const label = raw.trim()
  if (!label || label === tabId || /^\d+$/.test(label)) {
    return true
  }
  return LEAF_TITLE.test(label) || UUID_TITLE.test(label)
}

export function isStockHerdrDefaultTabLabel(label: string | undefined): boolean {
  if (!label) {
    return false
  }
  const raw = label.trim()
  return raw === 'Terminal' || /^\d+$/.test(raw) || LEAF_TITLE.test(raw)
}

export function nextOrcaTerminalTitle(tabs: readonly OrcaTabTitleSource[]): string {
  const used = new Set<number>()
  for (const tab of tabs) {
    const match = /^Terminal (\d+)$/.exec(tab.defaultTitle ?? tab.customTitle ?? tab.title)
    if (match) {
      used.add(Number(match[1]))
    }
  }
  let ordinal = 1
  while (used.has(ordinal)) {
    ordinal += 1
  }
  return `Terminal ${ordinal}`
}

export function orcaTabTitle(
  tab: OrcaTabTitleSource,
  siblings: readonly OrcaTabTitleSource[] = []
): string {
  const custom = tab.customTitle?.trim()
  if (custom && !isPlaceholderLabel(custom, tab.id)) {
    return custom
  }
  const live = tab.title.trim()
  if (live && !isPlaceholderLabel(live, tab.id)) {
    return live
  }
  const named = tab.defaultTitle?.trim()
  if (named && !isPlaceholderLabel(named, tab.id)) {
    return named
  }
  return nextOrcaTerminalTitle(siblings.filter((candidate) => candidate.id !== tab.id))
}
