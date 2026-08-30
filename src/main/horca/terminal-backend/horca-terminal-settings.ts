import { join } from 'node:path'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { Store } from '../../persistence'
import { getLocalStateRoot } from '../../local-state-root'
import {
  DEFAULT_HERDR_SESSION_NAME,
  HORCA_FLOATING_PROJECT_ID,
  normalizeHerdrBinarySource,
  normalizeHerdrSessionName,
  normalizeTerminalBackend,
  normalizeTerminalBackendActivation,
  type HerdrBinarySource,
  type TerminalBackend,
  type TerminalBackendActivation,
  type TerminalBackendPreference
} from '../../../shared/horca/terminal-backend'
import type {
  HorcaProjectTerminalSettingsUpdate,
  HorcaTerminalDefaultsUpdate,
  HorcaTerminalSettingsSnapshot
} from '../../../shared/horca/terminal-settings-api'
import {
  readHorcaTerminalSettingsFile as readSettingsFile,
  writeHorcaTerminalSettingsFile as writeSettingsFile
} from './horca-terminal-settings-file'

export type HorcaHerdrSettings = {
  binarySource: HerdrBinarySource
  defaultSessionName?: string
}

export type HorcaProjectTerminalSettings = {
  preference: TerminalBackendPreference
  sessionName?: string
  activations: Partial<Record<ExecutionHostId, TerminalBackendActivation>>
}

export type HorcaTerminalSettingsSource = {
  getDefaultBackend(): TerminalBackend
  getHerdrSettings(hostId: ExecutionHostId): HorcaHerdrSettings
  getProjectSettings(projectId: string): HorcaProjectTerminalSettings
  commitHerdrActivation(projectId: string, hostId: ExecutionHostId): void
  getSnapshot(): HorcaTerminalSettingsSnapshot
  updateDefaults(update: HorcaTerminalDefaultsUpdate): HorcaTerminalSettingsSnapshot
  updateProject(
    projectId: string,
    update: HorcaProjectTerminalSettingsUpdate
  ): HorcaTerminalSettingsSnapshot
  subscribe(listener: (snapshot: HorcaTerminalSettingsSnapshot) => void): () => void
}

type LegacyGlobalSettings = {
  terminalBackendDefault?: unknown
  herdrBinarySource?: unknown
  herdrSessionName?: unknown
  hostSettingOverrides?: Partial<Record<ExecutionHostId, { herdrBinarySource?: unknown }>>
}

type LegacyProjectSettings = {
  id: string
  herdrSessionName?: unknown
  terminalBackendPreference?: unknown
  terminalBackendByHost?: Partial<Record<ExecutionHostId, unknown>>
}

export function horcaTerminalSettingsPath(homePath?: string): string {
  return join(getLocalStateRoot(homePath), 'terminal-backends.json')
}

export function createHorcaTerminalSettingsSource(
  store: Store,
  settingsFile?: string
): HorcaTerminalSettingsSource {
  const listeners = new Set<(snapshot: HorcaTerminalSettingsSnapshot) => void>()
  const defaultBackendForMissingFile = (): TerminalBackend => {
    const legacy = store.getSettings() as unknown as LegacyGlobalSettings
    if (legacy.terminalBackendDefault === 'orca' || legacy.terminalBackendDefault === 'herdr') {
      return legacy.terminalBackendDefault
    }
    return 'herdr'
  }
  const legacyProject = (projectId: string): LegacyProjectSettings | undefined => {
    const getProjects = (store as Partial<Pick<Store, 'getProjects'>>).getProjects
    return getProjects?.call(store).find((project) => project.id === projectId) as
      | LegacyProjectSettings
      | undefined
  }

  const projectSettings = (projectId: string) => {
    const current = readSettingsFile(settingsFile)?.projects?.[projectId]
    const legacy = legacyProject(projectId)
    return {
      preference: current?.preference ?? legacy?.terminalBackendPreference,
      sessionName: current?.sessionName ?? legacy?.herdrSessionName,
      activations: current?.activations ?? legacy?.terminalBackendByHost ?? {}
    }
  }

  const source: HorcaTerminalSettingsSource = {
    getDefaultBackend: () => {
      const file = readSettingsFile(settingsFile)
      if (file) {
        return file.terminalBackendDefault === 'orca' ? 'orca' : 'herdr'
      }
      return defaultBackendForMissingFile()
    },
    getHerdrSettings: (hostId) => {
      const file = readSettingsFile(settingsFile)
      const legacy = store.getSettings() as unknown as LegacyGlobalSettings
      const configuredSessionName = file ? file.herdr?.defaultSessionName : legacy.herdrSessionName
      return {
        binarySource: normalizeHerdrBinarySource(
          file?.herdr?.hostBinarySources?.[hostId] ??
            file?.herdr?.binarySource ??
            legacy.hostSettingOverrides?.[hostId]?.herdrBinarySource ??
            legacy.herdrBinarySource
        ),
        defaultSessionName:
          normalizeHerdrSessionName(configuredSessionName) ?? DEFAULT_HERDR_SESSION_NAME
      }
    },
    getProjectSettings: (projectId) => {
      const project = projectSettings(projectId)
      const file = readSettingsFile(settingsFile)
      const activations: Partial<Record<ExecutionHostId, TerminalBackendActivation>> = {}
      for (const [hostId, value] of Object.entries(project.activations)) {
        const activation = normalizeTerminalBackendActivation(value)
        if (activation) {
          activations[hostId as ExecutionHostId] = activation
        }
      }
      return {
        preference:
          projectId === HORCA_FLOATING_PROJECT_ID &&
          (file?.floatingTerminalPreference === 'orca' ||
            file?.floatingTerminalPreference === 'herdr' ||
            file?.floatingTerminalPreference === 'inherit')
            ? file.floatingTerminalPreference
            : project.preference === 'orca' || project.preference === 'herdr'
              ? project.preference
              : 'inherit',
        sessionName: normalizeHerdrSessionName(project.sessionName),
        activations
      }
    },
    commitHerdrActivation: (projectId, hostId) => {
      if (!settingsFile) {
        const project = legacyProject(projectId)
        if (!project) {
          return
        }
        const updateProject = store.updateProject as unknown as (
          id: string,
          update: Record<string, unknown>
        ) => void
        updateProject(projectId, {
          terminalBackendByHost: {
            ...project.terminalBackendByHost,
            [hostId]: { backend: 'herdr', state: 'ready' }
          }
        })
        return
      }
      const file = readSettingsFile(settingsFile) ?? {}
      const currentProject = file.projects?.[projectId] ?? {}
      const current = normalizeTerminalBackendActivation(currentProject.activations?.[hostId])
      if (current?.state === 'ready' && current.backend === 'herdr') {
        return
      }
      writeSettingsFile(settingsFile, {
        ...file,
        terminalBackendDefault: file.terminalBackendDefault ?? defaultBackendForMissingFile(),
        projects: {
          ...file.projects,
          [projectId]: {
            ...currentProject,
            activations: {
              ...currentProject.activations,
              [hostId]: { backend: 'herdr', state: 'ready' }
            }
          }
        }
      })
      emit()
    },
    getSnapshot: () => {
      const projects: HorcaTerminalSettingsSnapshot['projects'] = {}
      for (const project of store.getProjects()) {
        projects[project.id] = source.getProjectSettings(project.id)
      }
      const herdr = source.getHerdrSettings('local')
      return {
        defaults: {
          defaultBackend: source.getDefaultBackend(),
          binarySource: herdr.binarySource,
          floatingPreference: source.getProjectSettings(HORCA_FLOATING_PROJECT_ID).preference,
          ...(herdr.defaultSessionName ? { defaultSessionName: herdr.defaultSessionName } : {})
        },
        projects
      }
    },
    updateDefaults: (update) => {
      if (!settingsFile) {
        throw new Error('Horca terminal settings file is unavailable')
      }
      const file = readSettingsFile(settingsFile) ?? {}
      const currentHerdr = file.herdr ?? {}
      const defaultBackend =
        update.defaultBackend === undefined
          ? (file.terminalBackendDefault ?? defaultBackendForMissingFile())
          : normalizeTerminalBackend(update.defaultBackend)
      const binarySource =
        update.binarySource === undefined
          ? currentHerdr.binarySource
          : normalizeHerdrBinarySource(update.binarySource)
      const defaultSessionName =
        update.defaultSessionName === undefined
          ? currentHerdr.defaultSessionName
          : normalizeHerdrSessionName(update.defaultSessionName)
      const floatingTerminalPreference =
        update.floatingPreference === undefined
          ? file.floatingTerminalPreference
          : update.floatingPreference === 'orca' || update.floatingPreference === 'herdr'
            ? update.floatingPreference
            : 'inherit'
      writeSettingsFile(settingsFile, {
        ...file,
        terminalBackendDefault: defaultBackend,
        floatingTerminalPreference,
        herdr: {
          ...currentHerdr,
          binarySource,
          defaultSessionName
        }
      })
      return emit()
    },
    updateProject: (projectId, update) => {
      if (!settingsFile) {
        throw new Error('Horca terminal settings file is unavailable')
      }
      if (!store.getProjects().some((project) => project.id === projectId)) {
        throw new Error(`Unknown Horca project: ${projectId}`)
      }
      const file = readSettingsFile(settingsFile) ?? {}
      const currentProject = file.projects?.[projectId] ?? {}
      const preference =
        update.preference === undefined
          ? currentProject.preference
          : update.preference === 'orca' || update.preference === 'herdr'
            ? update.preference
            : 'inherit'
      const sessionName =
        update.sessionName === undefined
          ? currentProject.sessionName
          : normalizeHerdrSessionName(update.sessionName)
      writeSettingsFile(settingsFile, {
        ...file,
        terminalBackendDefault: file.terminalBackendDefault ?? defaultBackendForMissingFile(),
        projects: {
          ...file.projects,
          [projectId]: {
            ...currentProject,
            preference,
            sessionName
          }
        }
      })
      return emit()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }

  function emit(): HorcaTerminalSettingsSnapshot {
    const snapshot = source.getSnapshot()
    for (const listener of listeners) {
      listener(snapshot)
    }
    return snapshot
  }

  return source
}
