import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { Store } from '../../persistence'
import {
  normalizeHerdrBinarySource,
  normalizeHerdrSessionName,
  normalizeTerminalBackend,
  normalizeTerminalBackendActivation,
  type HerdrBinarySource,
  type TerminalBackend,
  type TerminalBackendActivation,
  type TerminalBackendPreference
} from '../../../shared/horca/terminal-backend'

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

type HorcaSettingsFile = {
  version?: unknown
  terminalBackendDefault?: unknown
  herdr?: {
    binarySource?: unknown
    defaultSessionName?: unknown
    hostBinarySources?: Partial<Record<ExecutionHostId, unknown>>
  }
  projects?: Record<
    string,
    {
      preference?: unknown
      sessionName?: unknown
      activations?: Partial<Record<ExecutionHostId, unknown>>
    }
  >
}

export function horcaTerminalSettingsPath(profileDataFile: string): string {
  return join(dirname(profileDataFile), 'horca-terminal-settings.json')
}

function readSettingsFile(path: string | undefined): HorcaSettingsFile | null {
  if (!path) {
    return null
  }
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return value && typeof value === 'object' ? (value as HorcaSettingsFile) : null
  } catch {
    return null
  }
}

function writeSettingsFile(path: string, settings: HorcaSettingsFile): void {
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify({ ...settings, version: 1 }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  renameSync(temporary, path)
}

export function createHorcaTerminalSettingsSource(
  store: Store,
  settingsFile?: string
): HorcaTerminalSettingsSource {
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

  return {
    getDefaultBackend: () => {
      const file = readSettingsFile(settingsFile)
      if (file) {
        return normalizeTerminalBackend(file.terminalBackendDefault ?? 'herdr')
      }
      const legacy = store.getSettings() as unknown as LegacyGlobalSettings
      return settingsFile
        ? normalizeTerminalBackend(legacy.terminalBackendDefault ?? 'herdr')
        : normalizeTerminalBackend(legacy.terminalBackendDefault)
    },
    getHerdrSettings: (hostId) => {
      const file = readSettingsFile(settingsFile)
      const legacy = store.getSettings() as unknown as LegacyGlobalSettings
      return {
        binarySource: normalizeHerdrBinarySource(
          file?.herdr?.hostBinarySources?.[hostId] ??
            file?.herdr?.binarySource ??
            legacy.hostSettingOverrides?.[hostId]?.herdrBinarySource ??
            legacy.herdrBinarySource
        ),
        defaultSessionName: normalizeHerdrSessionName(
          file?.herdr?.defaultSessionName ?? legacy.herdrSessionName
        )
      }
    },
    getProjectSettings: (projectId) => {
      const project = projectSettings(projectId)
      const activations: Partial<Record<ExecutionHostId, TerminalBackendActivation>> = {}
      for (const [hostId, value] of Object.entries(project.activations)) {
        const activation = normalizeTerminalBackendActivation(value)
        if (activation) {
          activations[hostId as ExecutionHostId] = activation
        }
      }
      return {
        preference:
          project.preference === 'orca' || project.preference === 'herdr'
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
    }
  }
}
