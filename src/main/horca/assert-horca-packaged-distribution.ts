import { basename, resolve, win32 } from 'node:path'
import type { DistributionIdentity } from '../../shared/distribution-identity'

export function assertHorcaPackagedDistribution(args: {
  identity: DistributionIdentity
  isPackaged: boolean
  execPath: string
  userDataPath?: string
  expectedUserDataPath?: string
}): void {
  if (!args.isPackaged) {
    return
  }
  const executable = basename(win32.basename(args.execPath)).toLowerCase()
  const isHorcaExecutable =
    executable === 'horca' || executable === 'horca.exe' || executable === 'horca-ide'
  if (isHorcaExecutable && args.identity.distribution !== 'horca') {
    throw new Error('Horca package resolved the official Orca runtime identity')
  }
  if (args.identity.distribution === 'horca' && args.identity.stateRootDirName !== '.horca') {
    throw new Error('Horca package resolved an unsafe local state root')
  }
  if (
    args.identity.distribution === 'horca' &&
    args.userDataPath &&
    args.expectedUserDataPath &&
    !areSamePath(args.userDataPath, args.expectedUserDataPath)
  ) {
    throw new Error(`Horca package resolved an unsafe Electron profile: ${args.userDataPath}`)
  }
}

function areSamePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left)
  const normalizedRight = resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}
