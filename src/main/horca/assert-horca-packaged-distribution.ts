import { basename, win32 } from 'node:path'
import type { DistributionIdentity } from '../../shared/distribution-identity'

export function assertHorcaPackagedDistribution(args: {
  identity: DistributionIdentity
  isPackaged: boolean
  execPath: string
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
}
