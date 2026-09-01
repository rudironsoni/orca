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
          label={horcaTerminalSettingsCopy.projectPreference}
          description={`${horcaTerminalSettingsCopy.projectPreferenceDescription} ${
            snapshot.defaults.defaultBackend === 'herdr'
              ? horcaTerminalSettingsCopy.herdr
              : horcaTerminalSettingsCopy.orca
          }`}
          control={
            <SettingsSegmentedControl
              ariaLabel={horcaTerminalSettingsCopy.projectBackendAria}
              value={project.preference}
              onChange={(value) =>
                void updateProject(props.projectId, {
                  preference: value === 'orca' || value === 'herdr' ? value : 'inherit'
                })
              }
              options={[
                { value: 'inherit', label: horcaTerminalSettingsCopy.inherit },
                { value: 'herdr', label: horcaTerminalSettingsCopy.herdr },
                { value: 'orca', label: horcaTerminalSettingsCopy.orca }
              ]}
            />
          }
        />
        {effectiveBackend === 'herdr' ? (
          <SettingsRow
            label={horcaTerminalSettingsCopy.projectSession}
            description={horcaTerminalSettingsCopy.projectSessionDescription}
            control={
              <Input
                aria-label={horcaTerminalSettingsCopy.projectSessionAria}
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
