import { beforeEach, describe, expect, it, vi } from 'vitest'

const fsMocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdtempSync: vi.fn(),
  rmSync: vi.fn()
}))

vi.mock('node:child_process', () => ({ execFileSync: fsMocks.execFileSync }))
vi.mock('node:fs', () => ({
  existsSync: fsMocks.existsSync,
  mkdtempSync: fsMocks.mkdtempSync,
  rmSync: fsMocks.rmSync
}))
vi.mock('node:os', () => ({ tmpdir: () => '/primary-temp' }))

import { configHomeDir } from './herdr-stock-binary'

beforeEach(() => {
  fsMocks.mkdtempSync.mockReset()
})

describe('configHomeDir temp candidates', () => {
  it.runIf(process.platform !== 'win32')(
    'continues when the preferred temp root is unusable',
    () => {
      fsMocks.mkdtempSync
        .mockImplementationOnce(() => {
          throw new Error('read only')
        })
        .mockReturnValueOnce('/tmp/orca-h-short')

      expect(configHomeDir()).toBe('/tmp/orca-h-short')
      expect(fsMocks.mkdtempSync).toHaveBeenCalledTimes(2)
    }
  )

  it('does not try a POSIX fallback on Windows', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    fsMocks.mkdtempSync.mockImplementation(() => {
      throw new Error('read only')
    })

    expect(() => configHomeDir()).toThrow('No writable temp dir')
    expect(fsMocks.mkdtempSync).toHaveBeenCalledOnce()
    platform.mockRestore()
  })
})
