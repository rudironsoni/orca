import { describe, expect, it } from 'vitest'
import { applyHorcaViteDistributionEnv } from './horca-vite-distribution'

describe('applyHorcaViteDistributionEnv', () => {
  it('defaults an unset flag to Horca so local vite builds own ~/.horca', () => {
    const env: NodeJS.ProcessEnv = {}
    applyHorcaViteDistributionEnv(env)
    expect(env.ORCA_DOWNSTREAM_BUILD).toBe('1')
  })

  it('leaves an explicit official opt-out alone', () => {
    const env: NodeJS.ProcessEnv = { ORCA_DOWNSTREAM_BUILD: '0' }
    applyHorcaViteDistributionEnv(env)
    expect(env.ORCA_DOWNSTREAM_BUILD).toBe('0')
  })

  it('leaves packaging Horca builds alone', () => {
    const env: NodeJS.ProcessEnv = { ORCA_DOWNSTREAM_BUILD: '1' }
    applyHorcaViteDistributionEnv(env)
    expect(env.ORCA_DOWNSTREAM_BUILD).toBe('1')
  })

  it('defaults Horca dev userData to ~/.horca-dev', () => {
    const env: NodeJS.ProcessEnv = { HOME: '/home/test' }
    applyHorcaViteDistributionEnv(env)
    expect(env.ORCA_DEV_USER_DATA_PATH).toBe('/home/test/.horca-dev')
  })

  it('does not override an explicit ORCA_DEV_USER_DATA_PATH', () => {
    const env: NodeJS.ProcessEnv = {
      HOME: '/home/test',
      ORCA_DEV_USER_DATA_PATH: '/tmp/custom-profile'
    }
    applyHorcaViteDistributionEnv(env)
    expect(env.ORCA_DEV_USER_DATA_PATH).toBe('/tmp/custom-profile')
  })

  it('does not set ~/.horca-dev when compiling official', () => {
    const env: NodeJS.ProcessEnv = { HOME: '/home/test', ORCA_DOWNSTREAM_BUILD: '0' }
    applyHorcaViteDistributionEnv(env)
    expect(env.ORCA_DEV_USER_DATA_PATH).toBeUndefined()
  })
})
