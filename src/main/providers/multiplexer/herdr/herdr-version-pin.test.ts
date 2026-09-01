import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HERDR_SCHEMA_VERSION, SUPPORTED_HERDR_PROTOCOLS } from './herdr-runtime-contract'

// Why: the bundled herdr pin must be one of the protocols the SDK handshake accepts.
describe('herdr release version pin', () => {
  it('matches the protocol and schema the runtime contract expects', () => {
    const pin = JSON.parse(
      readFileSync(join(process.cwd(), 'config', 'horca', 'herdr-version.json'), 'utf8')
    ) as {
      version: string
      tag: string
      protocol: number
      schemaVersion: number
      sha256: Record<string, string>
    }

    expect(pin.version).toMatch(/^\d+\.\d+\.\d+(?:-preview\.[0-9a-z.-]+)?$/)
    expect(pin.tag).toMatch(/^preview-/)
    expect(SUPPORTED_HERDR_PROTOCOLS).toContain(pin.protocol)
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
