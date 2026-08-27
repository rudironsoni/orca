import {
  getHerdrDesktopSurface,
  type HerdrDesktopWindowHandle
} from '../../../horca/terminal-backend/herdr-desktop-surface'
import type { Store } from '../../../persistence'
import type { HerdrOrcaSurfaceAction } from './herdr-orca-surface-actions'
import type { HerdrImportedSurface } from './herdr-orca-surface-import'

const importedSurfaceOwners = new Map<string, { owner: HerdrDesktopWindowHandle; tabId: string }>()
const importedTabOwners = new Map<string, HerdrDesktopWindowHandle>()

export function createHerdrSurfaceSync(store: Store) {
  return {
    persist: (surface: HerdrImportedSurface) => {
      store.persistPtyBinding({
        worktreeId: surface.worktreeId,
        tabId: surface.tabId,
        leafId: surface.leafId,
        ptyId: surface.ptyId,
        ...(surface.cwd ? { startupCwd: surface.cwd } : {})
      })
    },
    present: presentHerdrImportedSurface,
    presentAction: presentHerdrSurfaceAction
  }
}

export function resetHerdrImportedSurfaceOwnersForTests(): void {
  importedSurfaceOwners.clear()
  importedTabOwners.clear()
}

function liveOwner(owner: HerdrDesktopWindowHandle | undefined): HerdrDesktopWindowHandle | null {
  return owner && !owner.isDestroyed() ? owner : null
}

function ownerForTab(tabId: string): HerdrDesktopWindowHandle | null {
  const existing = liveOwner(importedTabOwners.get(tabId))
  if (existing) {
    return existing
  }
  const desktop = getHerdrDesktopSurface()
  const owner =
    liveOwner(desktop.getFocusedWindow() ?? undefined) ??
    desktop.getAllWindows().find((candidate) => !candidate.isDestroyed()) ??
    null
  if (owner) {
    importedTabOwners.set(tabId, owner)
  }
  return owner
}

export function presentHerdrImportedSurface(surface: HerdrImportedSurface): void {
  const existing = importedSurfaceOwners.get(surface.ptyId)
  if (liveOwner(existing?.owner)) {
    return
  }
  const owner = ownerForTab(surface.tabId)
  if (!owner) {
    return
  }
  importedSurfaceOwners.set(surface.ptyId, { owner, tabId: surface.tabId })
  owner.send('ui:createTerminal', {
    worktreeId: surface.worktreeId,
    ptyId: surface.ptyId,
    tabId: surface.tabId,
    leafId: surface.leafId,
    title: surface.title,
    ...(surface.cwd ? { cwd: surface.cwd } : {}),
    activate: false,
    focus: false,
    presentation: 'background',
    ...(surface.splitFromLeafId
      ? {
          splitFromLeafId: surface.splitFromLeafId,
          splitDirection: surface.splitDirection ?? 'vertical'
        }
      : {})
  })
}

export function presentHerdrSurfaceAction(action: HerdrOrcaSurfaceAction): void {
  const owner = ownerForTab(action.tabId)
  if (!owner) {
    return
  }
  if (action.kind === 'rename') {
    owner.send('ui:renameTerminal', { tabId: action.tabId, title: action.title })
    return
  }
  if (action.kind === 'focus') {
    owner.send('ui:focusTerminal', {
      tabId: action.tabId,
      worktreeId: action.worktreeId,
      leafId: action.leafId
    })
    return
  }
  if (action.kind === 'close') {
    owner.send('ui:closeTerminal', { tabId: action.tabId })
    importedTabOwners.delete(action.tabId)
    for (const [ptyId, entry] of importedSurfaceOwners) {
      if (entry.tabId === action.tabId) {
        importedSurfaceOwners.delete(ptyId)
      }
    }
    return
  }
  owner.send('ui:applyTerminalLayout', { tabId: action.tabId, layout: action.layout })
}
