import {
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader
} from '@/components/settings/SettingsFormControls'
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
              { value: 'orca', label: 'Orca' },
              { value: 'herdr', label: 'Herdr' }
            ]}
          />
        }
      />
    </SearchableSetting>
  )
}
