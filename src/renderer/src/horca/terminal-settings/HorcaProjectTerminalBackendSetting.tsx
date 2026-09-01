import {
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader
} from '@/components/settings/SettingsFormControls'
import { Input } from '@/components/ui/input'
import { SearchableSetting } from '@/components/settings/SearchableSetting'
import {
  horcaTerminalSettingsCopy,
  matchesHorcaTerminalSettingsSearch
} from './horca-terminal-settings-copy'
import { useHorcaTerminalSettings } from './use-horca-terminal-settings'

export function HorcaProjectTerminalBackendSetting(props: {
  projectId: string
  projectName: string
  searchQuery: string
  forceVisible?: boolean
}): React.JSX.Element | null {
  const { snapshot, updateProject } = useHorcaTerminalSettings()
  const project = snapshot?.projects[props.projectId]
  if (!project || (!props.forceVisible && !matchesHorcaTerminalSettingsSearch(props.searchQuery))) {
    return null
  }
  const effectiveBackend =
    project.preference === 'inherit' ? snapshot.defaults.defaultBackend : project.preference
  return (
    <SearchableSetting
      title={horcaTerminalSettingsCopy.projectTitle}
      description={horcaTerminalSettingsCopy.projectDescription}
      keywords={[props.projectName, 'terminal', 'backend', 'herdr', 'multiplexer']}
      className="space-y-3"
      forceVisible={props.forceVisible}
    >
      <SettingsSubsectionHeader
        title={horcaTerminalSettingsCopy.projectTitle}
        description={horcaTerminalSettingsCopy.projectDescription}
      />
      <div className="divide-y divide-border/40">
        <SettingsRow
          label="Project preference"
          description={`Default backend: ${snapshot.defaults.defaultBackend === 'herdr' ? 'Herdr' : 'Orca'}`}
          control={
            <SettingsSegmentedControl
              ariaLabel="Project terminal backend"
              value={project.preference}
              onChange={(value) =>
                void updateProject(props.projectId, {
                  preference: value === 'orca' || value === 'herdr' ? value : 'inherit'
                })
              }
              options={[
                { value: 'inherit', label: 'Inherit' },
                { value: 'herdr', label: 'Herdr' },
                { value: 'orca', label: 'Orca' }
              ]}
            />
          }
        />
        {effectiveBackend === 'herdr' ? (
          <SettingsRow
            label="Herdr session"
            description="Clear this value to use the shared Herdr session."
            control={
              <Input
                aria-label="Project Herdr session name"
                className="w-72"
                maxLength={64}
                value={project.sessionName ?? ''}
                onChange={(event) =>
                  void updateProject(props.projectId, {
                    sessionName: event.target.value || null
                  })
                }
              />
            }
          />
        ) : null}
      </div>
    </SearchableSetting>
  )
}
