import { describe, expect, it } from 'vitest'
import {
  HERDR_PROTOCOL_VERSION,
  HERDR_SCHEMA_VERSION,
  HERDR_SUPPORTED_PROTOCOLS
} from './herdr-runtime-contract'

describe('stock Herdr compatibility', () => {
  it('accepts protocols 19, 20, and 21', () => {
    expect(HERDR_PROTOCOL_VERSION).toBe(21)
    expect(HERDR_SUPPORTED_PROTOCOLS).toEqual([19, 20, 21])
    expect(HERDR_SCHEMA_VERSION).toBe(1)
  })
})
