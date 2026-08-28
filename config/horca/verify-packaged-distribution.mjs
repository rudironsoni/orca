#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { extractFile, listPackage } from '@electron/asar'

function findAppAsars(directory) {
  const matches = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      matches.push(...findAppAsars(path))
    } else if (entry.isFile() && entry.name === 'app.asar') {
      matches.push(path)
    }
  }
  return matches
}

function readEntry(asarPath, entry) {
  return extractFile(asarPath, entry.replace(/^\//, '')).toString('utf8')
}

function readMatchingEntries(asarPath, predicate) {
  return listPackage(asarPath)
    .filter(predicate)
    .map((entry) => readEntry(asarPath, entry))
    .join('\n')
}

export function verifyHorcaAsar(asarPath) {
  const shared = readMatchingEntries(
    asarPath,
    (entry) => entry.startsWith('/out/shared/') && entry.endsWith('.js')
  )
  const main = readMatchingEntries(
    asarPath,
    (entry) => entry.startsWith('/out/main/') && entry.endsWith('.js')
  )
  const renderer = readMatchingEntries(
    asarPath,
    (entry) => entry.startsWith('/out/renderer/') && entry.endsWith('.js')
  )
  const checks = [
    ['runtime selects Horca', /DOWNSTREAM_DISTRIBUTION\s*=\s*["']horca["']/.test(shared)],
    ['product name is Horca', /productName:\s*["']Horca["']/.test(shared)],
    ['state root is .horca', /stateRootDirName:\s*["']\.horca["']/.test(shared)],
    ['public CLI is horca', /publicCli:\s*["']horca["']/.test(shared)],
    [
      'Horca Electron profile is configured',
      (main.match(/configureHorcaUserDataPath\(/g)?.length ?? 0) >= 2 &&
        /setPath\(["']userData["']/.test(main)
    ],
    ['Herdr provider is packaged', main.includes('HerdrPtyProvider')],
    ['Herdr settings are registered', main.includes('terminal-backends.json')],
    ['Herdr settings UI is packaged', renderer.includes('data-horca-settings')],
    ['Horca product title is packaged', renderer.includes('data-horca-product-name')]
  ]
  const failures = checks.filter(([, passed]) => !passed).map(([label]) => label)
  if (failures.length > 0) {
    throw new Error(`${basename(asarPath)} failed Horca checks: ${failures.join(', ')}`)
  }
  return checks.map(([label]) => label)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const distributionDirectory = resolve(process.argv[2] ?? 'dist')
  if (!existsSync(distributionDirectory)) {
    throw new Error(`Distribution directory does not exist: ${distributionDirectory}`)
  }
  const asars = findAppAsars(distributionDirectory)
  if (asars.length === 0) {
    throw new Error(`No app.asar found under ${distributionDirectory}`)
  }
  for (const asarPath of asars) {
    const checks = verifyHorcaAsar(asarPath)
    console.log(`Verified ${asarPath}: ${checks.join(', ')}`)
  }
}
