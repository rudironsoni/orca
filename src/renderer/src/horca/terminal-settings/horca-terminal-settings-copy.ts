export const horcaTerminalSettingsCopy = {
  title: 'Terminal backend',
  description: 'Choose which runtime owns new terminal sessions.',
  defaultBackend: 'Default backend',
  defaultBackendDescription: 'New projects use this backend until you choose another one.',
  binarySource: 'Herdr executable',
  binarySourceDescription: 'Use the bundled Herdr, PATH, or an absolute executable path.',
  customPath: 'Custom Herdr path',
  sessionName: 'Shared Herdr session',
  sessionNameDescription: 'Clear this value to use project-based Herdr session names.',
  projectTitle: 'Terminal backend',
  projectDescription: 'Choose the terminal backend for this project.'
} as const

export function matchesHorcaTerminalSettingsSearch(query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return true
  }
  return ['terminal', 'backend', 'herdr', 'multiplexer', 'runtime', 'session'].some((keyword) =>
    keyword.includes(normalized)
  )
}
