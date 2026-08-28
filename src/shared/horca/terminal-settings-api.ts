import type { ExecutionHostId } from '../execution-host'
import type {
  HerdrBinarySource,
  TerminalBackend,
  TerminalBackendActivation,
  TerminalBackendPreference
} from './terminal-backend'

export const HORCA_TERMINAL_SETTINGS_CHANNELS = {
  get: 'horca:terminal-settings:get',
  updateDefaults: 'horca:terminal-settings:update-defaults',
  updateProject: 'horca:terminal-settings:update-project',
  changed: 'horca:terminal-settings:changed'
} as const

export type HorcaTerminalDefaultsSnapshot = {
  defaultBackend: TerminalBackend
  binarySource: HerdrBinarySource
  defaultSessionName?: string
}

export type HorcaProjectTerminalSettingsSnapshot = {
  preference: TerminalBackendPreference
  sessionName?: string
  activations: Partial<Record<ExecutionHostId, TerminalBackendActivation>>
}

export type HorcaTerminalSettingsSnapshot = {
  defaults: HorcaTerminalDefaultsSnapshot
  projects: Record<string, HorcaProjectTerminalSettingsSnapshot>
}

export type HorcaTerminalDefaultsUpdate = {
  defaultBackend?: TerminalBackend
  binarySource?: HerdrBinarySource
  defaultSessionName?: string | null
}

export type HorcaProjectTerminalSettingsUpdate = {
  preference?: TerminalBackendPreference
  sessionName?: string | null
}

export type HorcaTerminalSettingsApi = {
  getSnapshot(): Promise<HorcaTerminalSettingsSnapshot>
  updateDefaults(update: HorcaTerminalDefaultsUpdate): Promise<HorcaTerminalSettingsSnapshot>
  updateProject(
    projectId: string,
    update: HorcaProjectTerminalSettingsUpdate
  ): Promise<HorcaTerminalSettingsSnapshot>
  subscribe(listener: (snapshot: HorcaTerminalSettingsSnapshot) => void): () => void
}
