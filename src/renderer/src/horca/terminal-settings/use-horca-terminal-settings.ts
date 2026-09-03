import { useCallback, useEffect, useState } from 'react'
import type {
  HorcaProjectTerminalSettingsUpdate,
  HorcaTerminalDefaultsUpdate,
  HorcaTerminalSettingsSnapshot
} from '../../../../shared/horca/terminal-settings-api'

export function useHorcaTerminalSettings(): {
  snapshot: HorcaTerminalSettingsSnapshot | null
  updateDefaults(update: HorcaTerminalDefaultsUpdate): Promise<void>
  updateProject(projectId: string, update: HorcaProjectTerminalSettingsUpdate): Promise<void>
} {
  const api = typeof window !== 'undefined' ? window.api?.horcaTerminalSettings : undefined
  const [snapshot, setSnapshot] = useState<HorcaTerminalSettingsSnapshot | null>(null)

  useEffect(() => {
    if (!api) {
      return
    }
    let active = true
    void api.getSnapshot().then((next) => {
      if (active) {
        setSnapshot(next)
      }
    })
    const unsubscribe = api.subscribe((next) => setSnapshot(next))
    return () => {
      active = false
      unsubscribe()
    }
  }, [api])

  const updateDefaults = useCallback(
    async (update: HorcaTerminalDefaultsUpdate) => {
      if (api) {
        setSnapshot(await api.updateDefaults(update))
      }
    },
    [api]
  )
  const updateProject = useCallback(
    async (projectId: string, update: HorcaProjectTerminalSettingsUpdate) => {
      if (api) {
        setSnapshot(await api.updateProject(projectId, update))
      }
    },
    [api]
  )
  return { snapshot, updateDefaults, updateProject }
}
