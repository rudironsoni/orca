import { afterEach, describe, expect, it } from 'vitest'
import { HerdrRuntimeError } from './herdr-runtime-contract'
import { clearWslHerdrExecutableCache, resolveWslHerdrExecutable } from './herdr-wsl-executable'

describe('resolveWslHerdrExecutable', () => {
  afterEach(() => {
    clearWslHerdrExecutableCache()
  })

  it('returns an absolute custom guest path without probing', () => {
    let probed = 0
    const path = resolveWslHerdrExecutable('Ubuntu', { kind: 'custom', path: '/opt/herdr' }, () => {
      probed += 1
      return '/unused'
    })
    expect(path).toBe('/opt/herdr')
    expect(probed).toBe(0)
  })

  it('rejects a non-absolute custom path', () => {
    expect(() =>
      resolveWslHerdrExecutable('Ubuntu', { kind: 'custom', path: 'herdr' }, () => '/unused')
    ).toThrow(HerdrRuntimeError)
  })

  it('caches the probed login-PATH binary per distro', () => {
    let probed = 0
    const probe = (distro: string) => {
      probed += 1
      return `/usr/bin/herdr-${distro}`
    }
    expect(resolveWslHerdrExecutable('Ubuntu', { kind: 'system' }, probe)).toBe(
      '/usr/bin/herdr-Ubuntu'
    )
    expect(resolveWslHerdrExecutable('Ubuntu', { kind: 'system' }, probe)).toBe(
      '/usr/bin/herdr-Ubuntu'
    )
    expect(resolveWslHerdrExecutable('Debian', { kind: 'system' }, probe)).toBe(
      '/usr/bin/herdr-Debian'
    )
    expect(probed).toBe(2)
  })

  it('throws herdr_unavailable when the probe fails', () => {
    expect(() =>
      resolveWslHerdrExecutable('Ubuntu', { kind: 'system' }, () => {
        throw new HerdrRuntimeError('herdr_unavailable', 'missing')
      })
    ).toThrow(/missing/)
  })
})
