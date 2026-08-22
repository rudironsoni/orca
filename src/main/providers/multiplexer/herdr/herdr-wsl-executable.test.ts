import { afterEach, describe, expect, it } from 'vitest'
import { HerdrRuntimeError } from './herdr-runtime-contract'
import { clearWslHerdrExecutableCache, resolveWslHerdrExecutable } from './herdr-wsl-executable'

describe('resolveWslHerdrExecutable', () => {
  afterEach(() => {
    clearWslHerdrExecutableCache()
  })

  it('returns an absolute custom guest path without probing', async () => {
    let probed = 0
    const path = await resolveWslHerdrExecutable(
      'Ubuntu',
      { kind: 'custom', path: '/opt/herdr' },
      () => {
        probed += 1
        return '/unused'
      }
    )
    expect(path).toBe('/opt/herdr')
    expect(probed).toBe(0)
  })

  it('rejects a non-absolute custom path', async () => {
    await expect(
      resolveWslHerdrExecutable('Ubuntu', { kind: 'custom', path: 'herdr' }, () => '/unused')
    ).rejects.toThrow(HerdrRuntimeError)
  })

  it('caches the probed login-PATH binary per distro', async () => {
    let probed = 0
    const probe = (distro: string) => {
      probed += 1
      return `/usr/bin/herdr-${distro}`
    }
    expect(await resolveWslHerdrExecutable('Ubuntu', { kind: 'system' }, probe)).toBe(
      '/usr/bin/herdr-Ubuntu'
    )
    expect(await resolveWslHerdrExecutable('Ubuntu', { kind: 'system' }, probe)).toBe(
      '/usr/bin/herdr-Ubuntu'
    )
    expect(await resolveWslHerdrExecutable('Debian', { kind: 'system' }, probe)).toBe(
      '/usr/bin/herdr-Debian'
    )
    expect(probed).toBe(2)
  })

  it('throws herdr_unavailable when the probe fails', async () => {
    await expect(
      resolveWslHerdrExecutable('Ubuntu', { kind: 'system' }, () => {
        throw new HerdrRuntimeError('herdr_unavailable', 'missing')
      })
    ).rejects.toThrow(/missing/)
  })
})
