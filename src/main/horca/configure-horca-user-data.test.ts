import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => '/home/rudi'),
    setPath: vi.fn()
  },
  distribution: { value: 'horca' as 'official' | 'horca' }
}))

vi.mock('electron', () => ({ app: mocks.app }))
vi.mock('../../shared/distribution-identity', () => ({
  getDistributionIdentity: () => ({
    distribution: mocks.distribution.value,
    productName: mocks.distribution.value === 'horca' ? 'Horca' : 'Orca',
    stateRootDirName: mocks.distribution.value === 'horca' ? '.horca' : '.orca'
  })
}))

import { configureHorcaUserDataPath } from './configure-horca-user-data'

describe('configureHorcaUserDataPath', () => {
  beforeEach(() => {
    mocks.distribution.value = 'horca'
    mocks.app.getPath.mockClear()
    mocks.app.setPath.mockClear()
  })

  it('isolates packaged Horca from the Orca Electron profile', () => {
    configureHorcaUserDataPath(false)

    expect(mocks.app.setPath).toHaveBeenCalledWith('userData', '/home/rudi/.horca')
  })

  it('leaves development profile selection to the existing dev configuration', () => {
    configureHorcaUserDataPath(true)

    expect(mocks.app.setPath).not.toHaveBeenCalled()
  })

  it('does not change official Orca profile selection', () => {
    mocks.distribution.value = 'official'

    configureHorcaUserDataPath(false)

    expect(mocks.app.setPath).not.toHaveBeenCalled()
  })
})
