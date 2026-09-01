import { describe, expect, it } from 'vitest'
import { HERDR_PROTOCOL_VERSION, HERDR_SCHEMA_VERSION } from './herdr-runtime-contract'

describe('stock Herdr compatibility', () => {
  it('pins protocol 21 and schema 1', () => {
    expect(HERDR_PROTOCOL_VERSION).toBe(21)
    expect(HERDR_SCHEMA_VERSION).toBe(1)
  })
})
