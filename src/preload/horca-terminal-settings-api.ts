import type { IpcRenderer } from 'electron'
import {
  HORCA_TERMINAL_SETTINGS_CHANNELS,
  type HorcaTerminalSettingsApi,
  type HorcaTerminalSettingsSnapshot
} from '../shared/horca/terminal-settings-api'

export function createHorcaTerminalSettingsApi(
  ipc: Pick<IpcRenderer, 'invoke' | 'on' | 'removeListener'>
): HorcaTerminalSettingsApi {
  const channels = HORCA_TERMINAL_SETTINGS_CHANNELS
  return {
    getSnapshot: () => ipc.invoke(channels.get),
    getHerdrHealth: () => ipc.invoke(channels.health),
    updateDefaults: (update) => ipc.invoke(channels.updateDefaults, update),
    updateProject: (projectId, update) => ipc.invoke(channels.updateProject, projectId, update),
    subscribe: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        snapshot: HorcaTerminalSettingsSnapshot
      ) => callback(snapshot)
      ipc.on(channels.changed, listener)
      return () => ipc.removeListener(channels.changed, listener)
    }
  }
}
