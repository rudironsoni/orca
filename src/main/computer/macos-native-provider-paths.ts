import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getDistributionIdentity } from '../../shared/distribution-identity'

// Why distribution-scoped: the helper .app carries its own TCC identity, so a
// downstream build ships (and must resolve) its own renamed helper bundle.
const HELPER_APP_NAME = `${getDistributionIdentity().productName} Computer Use.app`

export function resolveMacOSComputerUseAppPath(): string | null {
  const override = process.env.ORCA_COMPUTER_MACOS_HELPER_APP_PATH
  if (override && existsSync(override)) {
    return override
  }

  const packaged = [join(process.resourcesPath ?? '', HELPER_APP_NAME)]
  const dev = [
    join(process.cwd(), `native/computer-use-macos/.build/release/${HELPER_APP_NAME}`),
    resolve(__dirname, `../../native/computer-use-macos/.build/release/${HELPER_APP_NAME}`)
  ]
  const candidates = process.resourcesPath ? [...packaged, ...dev] : dev

  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null
}

export function resolveMacOSComputerUseExecutablePath(): string | null {
  const appPath = resolveMacOSComputerUseAppPath()
  if (!appPath) {
    return null
  }
  const executablePath = join(appPath, 'Contents', 'MacOS', 'orca-computer-use-macos')
  return existsSync(executablePath) ? executablePath : null
}
