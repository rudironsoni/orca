import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { applyDownstreamDistribution } = require('../electron-builder-downstream.cjs')
const previousDownstreamBuild = process.env.ORCA_DOWNSTREAM_BUILD

afterEach(() => {
  if (previousDownstreamBuild === undefined) {
    delete process.env.ORCA_DOWNSTREAM_BUILD
  } else {
    process.env.ORCA_DOWNSTREAM_BUILD = previousDownstreamBuild
  }
})

describe('Horca downstream packaging', () => {
  it('packages the managed Herdr binary on every desktop platform', () => {
    process.env.ORCA_DOWNSTREAM_BUILD = '1'
    const config = applyDownstreamDistribution({
      win: { extraResources: [] },
      mac: { extraResources: [] },
      linux: { extraResources: [] }
    })
    const expected = [{ from: 'out/horca-herdr/${arch}', to: 'herdr' }]

    expect(config.win.extraResources).toEqual(expect.arrayContaining(expected))
    expect(config.mac.extraResources).toEqual(expect.arrayContaining(expected))
    expect(config.linux.extraResources).toEqual(expect.arrayContaining(expected))
    expect(config.beforePack).toBeTypeOf('function')
  })
})
