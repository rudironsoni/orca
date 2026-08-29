import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyHorcaResources } from '../horca/verify-packaged-distribution.mjs'

const roots = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('packaged Horca Herdr resources', () => {
  it('requires the managed Herdr binary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'horca-package-'))
    roots.push(root)
    await mkdir(join(root, 'herdr'), { recursive: true })
    await writeFile(join(root, 'herdr', 'herdr'), '')

    expect(verifyHorcaResources(join(root, 'app.asar'))).toHaveLength(1)
  })

  it('rejects a package without Herdr resources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'horca-package-'))
    roots.push(root)

    expect(() => verifyHorcaResources(join(root, 'app.asar'))).toThrow(
      'bundled Herdr executable is packaged'
    )
  })

  it('requires the Herdr ConPTY runtime in Windows packages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'horca-package-'))
    roots.push(root)
    await mkdir(join(root, 'herdr', 'conpty'), { recursive: true })
    await writeFile(join(root, 'herdr', 'herdr.exe'), '')

    expect(() => verifyHorcaResources(join(root, 'app.asar'))).toThrow(
      'Herdr ConPTY runtime is packaged'
    )

    await writeFile(join(root, 'herdr', 'conpty', 'conpty.dll'), '')
    await writeFile(join(root, 'herdr', 'conpty', 'herdr-conpty.json'), '')
    expect(verifyHorcaResources(join(root, 'app.asar'))).toHaveLength(2)
  })
})
