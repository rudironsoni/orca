import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'

export function herdrSessionSocketPath(configHome: string, sessionName: string): string {
  if (!configHome.startsWith('/') || /[\n\r]/.test(configHome)) {
    throw new Error(`Herdr config home is not an absolute POSIX path: ${configHome}`)
  }
  if (sessionName.length === 0 || /[\\/\0]/.test(sessionName)) {
    throw new Error(`Herdr session name is not a single path segment: ${sessionName}`)
  }
  return posix.join(configHome, 'herdr', 'sessions', sessionName, 'herdr.sock')
}

export function herdrLocalRelayEndpoint(
  label: string,
  platform: NodeJS.Platform = process.platform
): { directory: string; listenPath: string } {
  const directory = mkdtempSync(join(tmpdir(), 'horca-herdr-'))
  const safe = label.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)
  if (platform === 'win32') {
    return { directory, listenPath: `\\\\.\\pipe\\horca-herdr-${process.pid}-${safe}` }
  }
  return { directory, listenPath: join(directory, 'herdr.sock') }
}
