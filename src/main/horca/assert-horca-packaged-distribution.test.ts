import { describe, expect, it } from 'vitest'
import { DISTRIBUTION_IDENTITIES } from '../../shared/distribution-identity'
import { assertHorcaPackagedDistribution } from './assert-horca-packaged-distribution'

describe('assertHorcaPackagedDistribution', () => {
  it.each([
    '/Applications/Horca.app/Contents/MacOS/Horca',
    'C:\\Program Files\\Horca\\Horca.exe',
    '/opt/Horca/horca-ide'
  ])('rejects the official runtime inside %s', (execPath) => {
    expect(() =>
      assertHorcaPackagedDistribution({
        identity: DISTRIBUTION_IDENTITIES.official,
        isPackaged: true,
        execPath
      })
    ).toThrow('Horca package resolved the official Orca runtime identity')
  })

  it('accepts the Horca runtime in the Horca package', () => {
    expect(() =>
      assertHorcaPackagedDistribution({
        identity: DISTRIBUTION_IDENTITIES.horca,
        isPackaged: true,
        execPath: '/Applications/Horca.app/Contents/MacOS/Horca'
      })
    ).not.toThrow()
  })

  it('rejects the Orca Electron profile in a Horca package', () => {
    expect(() =>
      assertHorcaPackagedDistribution({
        identity: DISTRIBUTION_IDENTITIES.horca,
        isPackaged: true,
        execPath: '/Applications/Horca.app/Contents/MacOS/Horca',
        userDataPath: '/Users/rudi/.orca',
        expectedUserDataPath: '/Users/rudi/.horca'
      })
    ).toThrow('Horca package resolved an unsafe Electron profile')
  })
})
