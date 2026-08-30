#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
const outputRoot = join(repoRoot, 'out', 'horca-mobile')
const mobileOutput = join(outputRoot, 'mobile')
const downstreamPatches = [
  join(import.meta.dirname, 'ghostty-port.patch'),
  join(import.meta.dirname, 'horca-branding.patch'),
  join(import.meta.dirname, 'ios-scene-lifecycle.patch')
]
const downstreamFiles = [
  {
    source: join(import.meta.dirname, 'ios-scene-lifecycle.js'),
    destination: join(mobileOutput, 'plugins', 'ios-scene-lifecycle.js')
  }
]

function trackedFiles(prefix) {
  return execFileSync('git', ['ls-files', '-z', prefix], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
    .split('\0')
    .filter(Boolean)
}

function copyTracked(prefix) {
  for (const path of trackedFiles(prefix)) {
    const source = join(repoRoot, path)
    if (!existsSync(source)) {
      continue
    }
    const destination = join(outputRoot, path)
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(source, destination)
  }
}

if (dirname(outputRoot) !== join(repoRoot, 'out') || !outputRoot.endsWith(`${sep}horca-mobile`)) {
  throw new Error(`Refusing to replace unexpected output path: ${outputRoot}`)
}
rmSync(outputRoot, { recursive: true, force: true })
copyTracked('mobile')
copyTracked('src/shared')
for (const file of downstreamFiles) {
  mkdirSync(dirname(file.destination), { recursive: true })
  cpSync(file.source, file.destination)
}
for (const patch of downstreamPatches) {
  execFileSync(
    'git',
    ['apply', '--binary', '-p1', `--directory=${relative(repoRoot, outputRoot)}`, patch],
    { cwd: repoRoot, stdio: 'inherit', maxBuffer: 64 * 1024 * 1024 }
  )
}

console.log(`Materialized Horca mobile at ${relative(repoRoot, mobileOutput)}`)
