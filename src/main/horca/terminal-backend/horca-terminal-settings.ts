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

export function createHorcaTerminalSettingsSource(store: Store): HorcaTerminalSettingsSource {
  const findProject = (projectId: string): LegacyProjectSettings | undefined => {
    const getProjects = (store as Partial<Pick<Store, 'getProjects'>>).getProjects
    if (!getProjects) {
      return undefined
    }
    return getProjects.call(store).find((project) => project.id === projectId) as
      | LegacyProjectSettings
      | undefined
  }

  return {
    getDefaultBackend: () => {
      const settings = store.getSettings() as unknown as LegacyGlobalSettings
      return normalizeTerminalBackend(settings.terminalBackendDefault)
    },
    getHerdrSettings: (hostId) => {
      const settings = store.getSettings() as unknown as LegacyGlobalSettings
      return {
        binarySource: normalizeHerdrBinarySource(
          settings.hostSettingOverrides?.[hostId]?.herdrBinarySource ?? settings.herdrBinarySource
        ),
        defaultSessionName: normalizeHerdrSessionName(settings.herdrSessionName)
      }
    },
    getProjectSettings: (projectId) => {
      const project = findProject(projectId)
      const activations: Partial<Record<ExecutionHostId, TerminalBackendActivation>> = {}
      for (const [hostId, value] of Object.entries(project?.terminalBackendByHost ?? {})) {
        const activation = normalizeTerminalBackendActivation(value)
        if (activation) {
          activations[hostId as ExecutionHostId] = activation
        }
      }
      const preference = project?.terminalBackendPreference
      return {
        preference: preference === 'orca' || preference === 'herdr' ? preference : 'inherit',
        sessionName: normalizeHerdrSessionName(project?.herdrSessionName),
        activations
      }
    },
    commitHerdrActivation: (projectId, hostId) => {
      const project = findProject(projectId)
      if (!project) {
        return
      }
      const current = normalizeTerminalBackendActivation(project.terminalBackendByHost?.[hostId])
      if (current?.state === 'ready' && current.backend === 'herdr') {
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
    }
  }
}
