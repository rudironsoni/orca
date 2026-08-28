import { Input } from '@/components/ui/input'
import {
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader
} from '@/components/settings/SettingsFormControls'
import { horcaTerminalSettingsCopy } from './horca-terminal-settings-copy'
import { useHorcaTerminalSettings } from './use-horca-terminal-settings'

export function HorcaTerminalBackendSection(): React.JSX.Element | null {
  const { snapshot, updateDefaults } = useHorcaTerminalSettings()
  if (!snapshot) {
    return null
  }
  const defaults = snapshot.defaults
  return (
    <section className="space-y-3" data-horca-settings="terminal-backend">
      <SettingsSubsectionHeader
        title={horcaTerminalSettingsCopy.title}
        description={horcaTerminalSettingsCopy.description}
      />
      <div className="divide-y divide-border/40">
        <SettingsRow
          label={horcaTerminalSettingsCopy.defaultBackend}
          description={horcaTerminalSettingsCopy.defaultBackendDescription}
          control={
            <SettingsSegmentedControl
              ariaLabel="Default terminal backend"
              value={defaults.defaultBackend}
              onChange={(value) =>
                void updateDefaults({ defaultBackend: value === 'herdr' ? 'herdr' : 'orca' })
              }
              options={[
                { value: 'orca', label: 'Orca' },
                { value: 'herdr', label: 'Herdr' }
              ]}
            />
          }
        />
        <SettingsRow
          label={horcaTerminalSettingsCopy.binarySource}
          description={horcaTerminalSettingsCopy.binarySourceDescription}
          control={
            <SettingsSegmentedControl
              ariaLabel="Herdr executable source"
              value={defaults.binarySource.kind}
              onChange={(value) =>
                void updateDefaults({
                  binarySource:
                    value === 'custom'
                      ? { kind: 'custom', path: '/usr/local/bin/herdr' }
                      : { kind: 'system' }
                })
              }
              options={[
                { value: 'system', label: 'From PATH' },
                { value: 'custom', label: 'Custom' }
              ]}
            />
          }
        />
        {defaults.binarySource.kind === 'custom' ? (
          <SettingsRow
            label={horcaTerminalSettingsCopy.customPath}
            description={horcaTerminalSettingsCopy.binarySourceDescription}
            control={
              <Input
                aria-label="Custom Herdr executable path"
                className="w-72"
                value={defaults.binarySource.path}
                onChange={(event) =>
                  void updateDefaults({
                    binarySource: { kind: 'custom', path: event.target.value }
                  })
                }
              />
            }
          />
        ) : null}
        <SettingsRow
          label={horcaTerminalSettingsCopy.sessionName}
          description={horcaTerminalSettingsCopy.sessionNameDescription}
          control={
            <Input
              aria-label="Shared Herdr session name"
              className="w-72"
              maxLength={64}
              placeholder="orca"
              value={defaults.defaultSessionName ?? ''}
              onChange={(event) =>
                void updateDefaults({ defaultSessionName: event.target.value || null })
              }
            />
          }
        />
      </div>
    </section>
  )
}
