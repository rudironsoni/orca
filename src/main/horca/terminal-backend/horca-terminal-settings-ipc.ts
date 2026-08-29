import { BrowserWindow, ipcMain } from 'electron'
import {
  HORCA_TERMINAL_SETTINGS_CHANNELS,
  type HorcaProjectTerminalSettingsUpdate,
  type HorcaTerminalDefaultsUpdate
} from '../../../shared/horca/terminal-settings-api'
import type { HorcaTerminalSettingsSource } from './horca-terminal-settings'
import { readLocalHerdrHealth } from './horca-herdr-health'

export function registerHorcaTerminalSettingsIpc(
  settings: HorcaTerminalSettingsSource
): () => void {
  const channels = HORCA_TERMINAL_SETTINGS_CHANNELS
  ipcMain.handle(channels.get, () => settings.getSnapshot())
  ipcMain.handle(channels.health, () => readLocalHerdrHealth(settings))
  ipcMain.handle(channels.updateDefaults, (_event, update: HorcaTerminalDefaultsUpdate) =>
    settings.updateDefaults(update ?? {})
  )
  ipcMain.handle(
    channels.updateProject,
    (_event, projectId: string, update: HorcaProjectTerminalSettingsUpdate) => {
      if (typeof projectId !== 'string' || projectId.trim() === '') {
        throw new Error('Horca project id is required')
      }
      return settings.updateProject(projectId, update ?? {})
    }
  )
  const unsubscribe = settings.subscribe((snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(channels.changed, snapshot)
      }
    }
  })
  return () => {
    unsubscribe()
    ipcMain.removeHandler(channels.get)
    ipcMain.removeHandler(channels.health)
    ipcMain.removeHandler(channels.updateDefaults)
    ipcMain.removeHandler(channels.updateProject)
  }
}
