#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const policy = JSON.parse(
  readFileSync(join(repoRoot, 'config', 'horca', 'overlay-policy.json'), 'utf8')
)
const upstreamRef = process.env.HORCA_UPSTREAM_REF || policy.upstreamRef

function runGit(args, { allowNoMatches = false } = {}) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
  if (allowNoMatches && result.status === 1) {
    return ''
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`)
  }
  return result.stdout.trim()
}

function matchesPath(path, exactPaths, prefixes) {
  return exactPaths.includes(path) || prefixes.some((prefix) => path.startsWith(prefix))
}

function isForkOnly(path) {
  return matchesPath(path, policy.forkOnlyPaths, policy.forkOnlyPrefixes)
}

function isDenied(path) {
  const deniedPaths = policy.deniedOverlayPaths ?? []
  return (
    deniedPaths.includes(path) ||
    policy.deniedOverlayPrefixes.some((prefix) => path.startsWith(prefix))
  )
}

const failures = []
const overlaysByPath = new Map()
for (const overlay of policy.overlays) {
  for (const field of ['path', 'subsystem', 'reason', 'dropWhen']) {
    if (typeof overlay[field] !== 'string' || overlay[field].trim() === '') {
      failures.push(`Overlay entry is missing ${field}: ${JSON.stringify(overlay)}`)
    }
  }
  if (overlaysByPath.has(overlay.path)) {
    failures.push(`Duplicate overlay entry: ${overlay.path}`)
  }
  overlaysByPath.set(overlay.path, overlay)
}

const changes = runGit(['diff', '--name-status', `${upstreamRef}...HEAD`])
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [rawStatus, ...paths] = line.split('\t')
    return { status: rawStatus[0], path: paths.at(-1) }
  })

const numstat = new Map()
for (const line of runGit(['diff', '--numstat', `${upstreamRef}...HEAD`]).split('\n')) {
  if (!line) {
    continue
  }
  const [added, deleted, ...paths] = line.split('\t')
  numstat.set(paths.at(-1), {
    added: added === '-' ? 0 : Number(added),
    deleted: deleted === '-' ? 0 : Number(deleted)
  })
}

const activeOverlayPaths = new Set()
let forkOnlyFiles = 0
let modifiedUpstreamFiles = 0
let modifiedUpstreamLines = 0
let deletedUpstreamFiles = 0
let deniedOverlays = 0
let unjustifiedOverlays = 0
let temporaryOverlays = 0
let highChurnOverlays = 0
let workflowOverlays = 0
let localeOverlays = 0
let e2eOverlays = 0

for (const change of changes) {
  if (isForkOnly(change.path)) {
    forkOnlyFiles += 1
    continue
  }
  if (change.status === 'D') {
    deletedUpstreamFiles += 1
    failures.push(`Deleted upstream file: ${change.path}`)
    continue
  }

  modifiedUpstreamFiles += 1
  const stats = numstat.get(change.path)
  modifiedUpstreamLines += (stats?.added || 0) + (stats?.deleted || 0)

  if (change.path.startsWith('.github/workflows/')) {
    workflowOverlays += 1
  }
  if (change.path.startsWith('src/renderer/src/i18n/locales/')) {
    localeOverlays += 1
  }
  if (change.path.startsWith('tests/e2e/')) {
    e2eOverlays += 1
  }
  if (
    change.path.startsWith('.github/workflows/') ||
    change.path.startsWith('src/renderer/src/i18n/locales/') ||
    change.path.startsWith('tests/e2e/')
  ) {
    highChurnOverlays += 1
  }

  if (isDenied(change.path)) {
    deniedOverlays += 1
    failures.push(`Denied upstream overlay: ${change.path}`)
  }

  const overlay = overlaysByPath.get(change.path)
  if (!overlay) {
    unjustifiedOverlays += 1
    failures.push(`Unregistered upstream overlay: ${change.path}`)
    continue
  }

  activeOverlayPaths.add(change.path)
  if (policy.temporarySubsystems.includes(overlay.subsystem)) {
    temporaryOverlays += 1
  }
}

const staleOverlays = [...overlaysByPath.keys()].filter((path) => !activeOverlayPaths.has(path))
for (const path of staleOverlays) {
  failures.push(`Stale overlay ledger entry: ${path}`)
}

const upstreamOverlayPaths = changes
  .filter((change) => !isForkOnly(change.path))
  .map((change) => change.path)
const upstreamDiff =
  upstreamOverlayPaths.length === 0
    ? ''
    : runGit(['diff', '--unified=0', `${upstreamRef}...HEAD`, '--', ...upstreamOverlayPaths])
const modifiedUpstreamHunks = upstreamDiff
  .split('\n')
  .filter((line) => line.startsWith('@@ ')).length

const herdrReferences = runGit(
  [
    'grep',
    '-l',
    '-E',
    'from [\'"][^\'"]*herdr|import\\([\'"][^\'"]*herdr',
    'HEAD',
    '--',
    'src',
    'config',
    'electron.vite.config.ts'
  ],
  { allowNoMatches: true }
)
  .split('\n')
  .filter(Boolean)
  .map((line) => line.replace(/^HEAD:/, ''))
  .filter((path) => !isForkOnly(path))

for (const path of herdrReferences) {
  failures.push(`Herdr import outside a fork-owned path: ${path}`)
}

const permanentOverlays = modifiedUpstreamFiles - temporaryOverlays

console.log('Horca downstream delta')
console.log(`Upstream: ${upstreamRef}@${runGit(['rev-parse', '--short=12', upstreamRef])}`)
console.log(`Fork-only files: ${forkOnlyFiles}`)
console.log(`Modified upstream files: ${modifiedUpstreamFiles}`)
console.log(`Modified upstream files excluding temporary patches: ${permanentOverlays}`)
console.log(`Modified upstream lines: ${modifiedUpstreamLines}`)
console.log(`Modified upstream hunks: ${modifiedUpstreamHunks}`)
console.log(`Deleted upstream files: ${deletedUpstreamFiles}`)
console.log(`High-churn overlays: ${highChurnOverlays}`)
console.log(`Workflow overlays: ${workflowOverlays}`)
console.log(`Locale overlays: ${localeOverlays}`)
console.log(`E2E overlays: ${e2eOverlays}`)
console.log(`Unjustified overlays: ${unjustifiedOverlays}`)
console.log(`Denied overlays: ${deniedOverlays}`)
console.log(`Herdr imports outside fork-owned paths: ${herdrReferences.length}`)

if (failures.length > 0) {
  console.error('\nOverlay policy failed:')
  for (const failure of failures) {
    console.error(`  ${failure}`)
  }
  process.exit(1)
}
