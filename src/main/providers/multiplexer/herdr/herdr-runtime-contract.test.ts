import { describe, expect, it } from 'vitest'
import { HERDR_SCHEMA_VERSION, SUPPORTED_HERDR_PROTOCOLS } from './herdr-runtime-contract'

describe('stock Herdr compatibility', () => {
  it('accepts protocols 19, 20, and 21', () => {
    expect(SUPPORTED_HERDR_PROTOCOLS).toEqual([19, 20, 21])
    expect(HERDR_SCHEMA_VERSION).toBe(1)
  })
})
