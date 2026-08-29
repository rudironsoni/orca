import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HERDR_PROTOCOL_VERSION, HERDR_SCHEMA_VERSION } from './herdr-runtime-contract'

// Why: the stock herdr release the e2e downloads (see
// config/horca/scripts/download-herdr-release.mjs) must speak the protocol and schema
// the runtime contract asserts, or assertHerdrServerCompatible fails at the
// first handshake. Pinning both in config/horca/herdr-version.json lets this test
// catch a pin/code drift at unit-test time instead of in a live CI lane.
describe('herdr release version pin', () => {
  it('matches the protocol and schema the runtime contract expects', () => {
    const pin = JSON.parse(
      readFileSync(join(process.cwd(), 'config', 'horca', 'herdr-version.json'), 'utf8')
    ) as {
      version: string
      protocol: number
      schemaVersion: number
      sha256: Record<string, string>
    }

    expect(pin.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(pin.protocol).toBe(HERDR_PROTOCOL_VERSION)
    expect(pin.schemaVersion).toBe(HERDR_SCHEMA_VERSION)
    expect(pin.sha256).toEqual({
      'herdr-linux-aarch64': expect.stringMatching(/^[a-f0-9]{64}$/),
      'herdr-linux-x86_64': expect.stringMatching(/^[a-f0-9]{64}$/),
      'herdr-macos-aarch64': expect.stringMatching(/^[a-f0-9]{64}$/),
      'herdr-macos-x86_64': expect.stringMatching(/^[a-f0-9]{64}$/),
      'herdr-windows-x86_64.zip': expect.stringMatching(/^[a-f0-9]{64}$/)
    })
  })
})
