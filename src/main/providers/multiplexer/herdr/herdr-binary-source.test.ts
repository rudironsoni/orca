import { describe, expect, it } from 'vitest'
import { normalizeHerdrBinarySource } from '../../../../shared/horca/terminal-backend'
import { resolveHerdrExecutable } from './herdr-provider-factory'

describe('stock Herdr binary source', () => {
  it('defaults missing and invalid settings to Herdr from PATH', () => {
    expect(normalizeHerdrBinarySource(undefined)).toEqual({ kind: 'system' })
    expect(normalizeHerdrBinarySource({ kind: 'invalid' })).toEqual({ kind: 'system' })
  })

  it('preserves an explicit bundled binary choice', () => {
    expect(normalizeHerdrBinarySource({ kind: 'managed' })).toEqual({ kind: 'managed' })
  })

  it('uses the target platform executable for PATH installs', () => {
    expect(resolveHerdrExecutable({ kind: 'system' }, 'darwin')).toBe('herdr')
    expect(resolveHerdrExecutable({ kind: 'system' }, 'win32')).toBe('herdr.exe')
  })

  it('preserves a configured executable path', () => {
    expect(resolveHerdrExecutable({ kind: 'custom', path: ' /opt/herdr ' }, 'linux')).toBe(
      '/opt/herdr'
    )
  })
})
