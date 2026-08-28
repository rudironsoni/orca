import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OrcaDistribution } from '../shared/distribution-identity'
import { getLocalStateRoot } from './local-state-root'

const globalWithOverride = globalThis as { ORCA_DISTRIBUTION?: OrcaDistribution }

afterEach(() => {
  globalWithOverride.ORCA_DISTRIBUTION = 'official'
})

describe('getLocalStateRoot', () => {
  it('uses ~/.orca when the official distribution is active', () => {
    globalWithOverride.ORCA_DISTRIBUTION = 'official'
    expect(getLocalStateRoot('/home/test')).toBe(join('/home/test', '.orca'))
  })

  it('uses ~/.horca when the Horca distribution is active', () => {
    globalWithOverride.ORCA_DISTRIBUTION = 'horca'
    expect(getLocalStateRoot('/home/test')).toBe(join('/home/test', '.horca'))
  })
})
