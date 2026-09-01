import { Input } from '@/components/ui/input'
import {
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader
} from '@/components/settings/SettingsFormControls'
import { horcaTerminalSettingsCopy } from './horca-terminal-settings-copy'
import { useHorcaTerminalSettings } from './use-horca-terminal-settings'
import { useEffect, useState } from 'react'
import type { HorcaHerdrHealth } from '../../../../shared/horca/terminal-settings-api'

export function HorcaTerminalBackendSection(): React.JSX.Element | null {
  const { snapshot, updateDefaults } = useHorcaTerminalSettings()
  const [health, setHealth] = useState<HorcaHerdrHealth | null>(null)
  const defaults = snapshot?.defaults
  useEffect(() => {
    if (defaults?.defaultBackend !== 'herdr') {
      setHealth(null)
      return
    }
    let active = true
    void window.api.horcaTerminalSettings?.getHerdrHealth().then((next) => {
      if (active) {
        setHealth(next)
      }
    })
    return () => {
      active = false
    }
  }, [defaults?.binarySource, defaults?.defaultBackend])
  if (!snapshot || !defaults) {
    return null
  }
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
              ariaLabel={horcaTerminalSettingsCopy.defaultBackendAria}
              value={defaults.defaultBackend}
              onChange={(value) =>
                void updateDefaults({ defaultBackend: value === 'herdr' ? 'herdr' : 'orca' })
              }
              options={[
                { value: 'herdr', label: horcaTerminalSettingsCopy.herdr },
                { value: 'orca', label: horcaTerminalSettingsCopy.orca }
              ]}
            />
          }
        />
        <SettingsRow
          label={horcaTerminalSettingsCopy.floatingTerminal}
          description={horcaTerminalSettingsCopy.floatingTerminalDescription}
          control={
            <SettingsSegmentedControl
              ariaLabel={horcaTerminalSettingsCopy.floatingTerminalAria}
              value={defaults.floatingPreference}
              onChange={(value) =>
                void updateDefaults({
                  floatingPreference: value === 'orca' || value === 'herdr' ? value : 'inherit'
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
        {defaults.defaultBackend === 'herdr' ? (
          <>
            <SettingsRow
              label={horcaTerminalSettingsCopy.herdrStatus}
              description={horcaTerminalSettingsCopy.herdrStatusDescription}
              control={
                <span
                  className={
                    health?.status === 'unavailable'
                      ? 'max-w-72 text-right text-xs text-destructive'
                      : 'max-w-72 text-right text-xs text-muted-foreground'
                  }
                >
                  {health?.status === 'ready'
                    ? horcaTerminalSettingsCopy.ready(health.version)
                    : (health?.error ?? horcaTerminalSettingsCopy.checking)}
                </span>
              }
            />
            <SettingsRow
              label={horcaTerminalSettingsCopy.binarySource}
              description={horcaTerminalSettingsCopy.binarySourceDescription}
              control={
                <SettingsSegmentedControl
                  ariaLabel={horcaTerminalSettingsCopy.herdrSourceAria}
                  value={defaults.binarySource.kind}
                  onChange={(value) =>
                    void updateDefaults({
                      binarySource:
                        value === 'custom'
                          ? { kind: 'custom', path: '/usr/local/bin/herdr' }
                          : value === 'system'
                            ? { kind: 'system' }
                            : { kind: 'managed' }
                    })
                  }
                  options={[
                    { value: 'system', label: horcaTerminalSettingsCopy.fromPath },
                    { value: 'managed', label: horcaTerminalSettingsCopy.bundled },
                    { value: 'custom', label: horcaTerminalSettingsCopy.custom }
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
                    aria-label={horcaTerminalSettingsCopy.customPathAria}
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
                  aria-label={horcaTerminalSettingsCopy.sessionNameAria}
                  className="w-72"
                  maxLength={64}
                  placeholder={horcaTerminalSettingsCopy.sessionNamePlaceholder}
                  value={defaults.defaultSessionName ?? ''}
                  onChange={(event) =>
                    void updateDefaults({ defaultSessionName: event.target.value || null })
                  }
                />
              }
            />
          </>
        ) : null}
      </div>
    </section>
  )
}
