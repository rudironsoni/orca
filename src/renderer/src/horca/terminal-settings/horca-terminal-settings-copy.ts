import { translate } from '@/i18n/i18n'

export const horcaTerminalSettingsCopy = {
  get title() {
    return translate('auto.horca.terminalSettings.title', 'Terminal backend')
  },
  get description() {
    return translate(
      'auto.horca.terminalSettings.description',
      'Choose which runtime owns new terminal sessions.'
    )
  },
  get defaultBackend() {
    return translate('auto.horca.terminalSettings.defaultBackend', 'Default backend')
  },
  get defaultBackendDescription() {
    return translate(
      'auto.horca.terminalSettings.defaultBackendDescription',
      'New projects use this backend until you choose another one.'
    )
  },
  get defaultBackendAria() {
    return translate('auto.horca.terminalSettings.defaultBackendAria', 'Default terminal backend')
  },
  get herdr() {
    return translate('auto.horca.terminalSettings.herdr', 'Herdr')
  },
  get orca() {
    return translate('auto.horca.terminalSettings.orca', 'Orca')
  },
  get inherit() {
    return translate('auto.horca.terminalSettings.inherit', 'Inherit')
  },
  get floatingTerminal() {
    return translate('auto.horca.terminalSettings.floatingTerminal', 'Floating terminal')
  },
  get floatingTerminalDescription() {
    return translate(
      'auto.horca.terminalSettings.floatingTerminalDescription',
      'Choose a backend for floating terminals, or inherit the default.'
    )
  },
  get floatingTerminalAria() {
    return translate(
      'auto.horca.terminalSettings.floatingTerminalAria',
      'Floating terminal backend'
    )
  },
  get herdrStatus() {
    return translate('auto.horca.terminalSettings.herdrStatus', 'Herdr status')
  },
  get herdrStatusDescription() {
    return translate(
      'auto.horca.terminalSettings.herdrStatusDescription',
      'The Herdr executable used for local terminals.'
    )
  },
  ready(version: string): string {
    return translate('auto.horca.terminalSettings.ready', 'Ready, {{value0}}', {
      value0: version
    })
  },
  get checking() {
    return translate('auto.horca.terminalSettings.checking', 'Checking…')
  },
  get binarySource() {
    return translate('auto.horca.terminalSettings.binarySource', 'Herdr executable')
  },
  get binarySourceDescription() {
    return translate(
      'auto.horca.terminalSettings.binarySourceDescription',
      'Use Herdr from PATH, the bundled Herdr, or an absolute path.'
    )
  },
  get herdrSourceAria() {
    return translate('auto.horca.terminalSettings.herdrSourceAria', 'Herdr executable source')
  },
  get fromPath() {
    return translate('auto.horca.terminalSettings.fromPath', 'From PATH')
  },
  get bundled() {
    return translate('auto.horca.terminalSettings.bundled', 'Bundled')
  },
  get custom() {
    return translate('auto.horca.terminalSettings.custom', 'Custom')
  },
  get customPath() {
    return translate('auto.horca.terminalSettings.customPath', 'Custom Herdr path')
  },
  get customPathAria() {
    return translate('auto.horca.terminalSettings.customPathAria', 'Custom Herdr executable path')
  },
  get sessionName() {
    return translate('auto.horca.terminalSettings.sessionName', 'Shared Herdr session')
  },
  get sessionNameDescription() {
    return translate(
      'auto.horca.terminalSettings.sessionNameDescription',
      'Clear this value to use the Horca session.'
    )
  },
  get sessionNameAria() {
    return translate('auto.horca.terminalSettings.sessionNameAria', 'Shared Herdr session name')
  },
  get sessionNamePlaceholder() {
    return translate('auto.horca.terminalSettings.sessionNamePlaceholder', 'horca')
  },
  get projectTitle() {
    return translate('auto.horca.terminalSettings.projectTitle', 'Terminal backend')
  },
  get projectDescription() {
    return translate(
      'auto.horca.terminalSettings.projectDescription',
      'Choose the terminal backend for this project.'
    )
  },
  get projectPreference() {
    return translate('auto.horca.terminalSettings.projectPreference', 'Project preference')
  },
  get projectPreferenceDescription() {
    return translate('auto.horca.terminalSettings.projectPreferenceDescription', 'Default backend:')
  },
  get projectBackendAria() {
    return translate('auto.horca.terminalSettings.projectBackendAria', 'Project terminal backend')
  },
  get projectSession() {
    return translate('auto.horca.terminalSettings.projectSession', 'Herdr session')
  },
  get projectSessionDescription() {
    return translate(
      'auto.horca.terminalSettings.projectSessionDescription',
      'Clear this value to use the shared Herdr session.'
    )
  },
  get projectSessionAria() {
    return translate('auto.horca.terminalSettings.projectSessionAria', 'Project Herdr session name')
  }
}

export function matchesHorcaTerminalSettingsSearch(query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return true
  }
  return ['terminal', 'backend', 'herdr', 'multiplexer', 'runtime', 'session'].some((keyword) =>
    keyword.includes(normalized)
  )
}
