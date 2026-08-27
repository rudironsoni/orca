import { resolveDesiredTerminalBackend } from '../../../../shared/horca/terminal-backend'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../../../shared/execution-host'
import type { HorcaTerminalSettingsSource } from '../../../horca/terminal-backend/horca-terminal-settings'

export function projectWantsHerdr(
  projectId: string,
  settings: HorcaTerminalSettingsSource,
  hostId: ExecutionHostId
): boolean {
  const project = settings.getProjectSettings(projectId)
  return (
    resolveDesiredTerminalBackend({
      globalDefault: settings.getDefaultBackend(),
      preference: project.preference,
      activation: project.activations[hostId]
    }) === 'herdr'
  )
}

export function resolveSpawnHostId(
  requestedHostId: ExecutionHostId,
  worktreeHostId: string | undefined
): ExecutionHostId {
  if (requestedHostId !== LOCAL_EXECUTION_HOST_ID) {
    return requestedHostId
  }
  if (worktreeHostId?.startsWith('wsl:')) {
    return worktreeHostId as ExecutionHostId
  }
  return LOCAL_EXECUTION_HOST_ID
}

export function commitHerdrHostActivation(
  settings: HorcaTerminalSettingsSource,
  projectId: string,
  hostId: ExecutionHostId
): void {
  settings.commitHerdrActivation(projectId, hostId)
}
