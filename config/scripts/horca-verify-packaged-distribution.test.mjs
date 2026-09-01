import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  evaluateHorcaAsarContents,
  verifyHorcaResources
} from '../horca/verify-packaged-distribution.mjs'

const roots = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('packaged Horca asar probes', () => {
  const passing = {
    shared: [
      'DOWNSTREAM_DISTRIBUTION = "horca"',
      'productName: "Horca"',
      'stateRootDirName: ".horca"',
      'publicCli: "horca"'
    ].join('\n'),
    main: [
      'horca-packaged-electron-profile',
      'setPath(`userData`, root)',
      'Could not resolve herdr target for spawn',
      'is incompatible with SDK protocol',
      'terminal-backends.json'
    ].join('\n'),
    renderer: 'data-horca-settings data-horca-product-name'
  }

  it('accepts minify-stable Horca and Herdr markers', () => {
    expect(evaluateHorcaAsarContents(passing).failures).toEqual([])
  })

  it('accepts quoted setPath userData as well as backticks', () => {
    expect(
      evaluateHorcaAsarContents({
        ...passing,
        main: passing.main.replace('setPath(`userData`, root)', 'setPath("userData", root)')
      }).failures
    ).toEqual([])
  })

  it('rejects minified identifier-only profile and provider probes', () => {
    expect(
      evaluateHorcaAsarContents({
        ...passing,
        main: 'configureHorcaUserDataPath(); class HerdrPtyProvider {} terminal-backends.json'
      }).failures
    ).toEqual([
      'Horca Electron profile is configured',
      'Herdr provider is packaged',
      'Herdr SDK is packaged'
    ])
  })
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
