import { afterEach, describe, expect, it } from 'vitest'
import { encodePairingOffer, decodePairingOffer, parsePairingCode } from './pairing'
import type { PairingOffer } from './pairing'
import type { OrcaDistribution } from './distribution-identity'

const globalWithOverride = globalThis as { ORCA_DISTRIBUTION?: OrcaDistribution }

afterEach(() => {
  delete globalWithOverride.ORCA_DISTRIBUTION
})

describe('Horca pairing deep links', () => {
  const offer: PairingOffer = {
    v: 2,
    endpoint: 'ws://192.168.1.10:6768',
    deviceToken: 'abcdef1234567890abcdef1234567890abcdef1234567890',
    publicKeyB64: 'dGVzdC1wdWJsaWMta2V5LWJhc2U2NC1lbmNvZGVk'
  }

  it('emits horca://pair while still accepting the orca:// wire format', () => {
    globalWithOverride.ORCA_DISTRIBUTION = 'horca'
    const url = encodePairingOffer(offer)
    expect(url).toMatch(/^horca:\/\/pair\?code=/)
    expect(decodePairingOffer(url)).toEqual(offer)

    const officialUrl = url.replace(/^horca:/, 'orca:')
    expect(parsePairingCode(officialUrl)).toEqual(offer)
  })
})
