#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const stableTag = /^v(\d+)\.(\d+)\.(\d+)-horca\.(\d+)$/
const betaTag = /^v(\d+)\.(\d+)\.(\d+)-horca-beta\.(\d+)$/

function git(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`)
  }
  return result.stdout.trim()
}

function gitSucceeds(args) {
  return spawnSync('git', args, { cwd: repoRoot, stdio: 'ignore' }).status === 0
}

function output(name, value) {
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

function packageVersion(commit) {
  return JSON.parse(git(['show', `${commit}:package.json`])).version
}

export function parseStableVersion(tag) {
  return tag.match(/^v?(\d+\.\d+\.\d+)$/)?.[1] ?? null
}

export function selectReleaseCore(packageVer, orcaStableVersion) {
  const packageCore = packageVer.match(/^(\d+\.\d+\.\d+)/)?.[1]
  const orcaCore = parseStableVersion(orcaStableVersion ?? '')
  return orcaCore ?? packageCore ?? null
}

function highestLocalStableVersion() {
  const versions = git(['tag', '--list', 'v*'])
    .split('\n')
    .flatMap((tag) => {
      const version = parseStableVersion(tag)
      return version ? [version] : []
    })
  versions.sort((left, right) => {
    const a = left.split('.').map(Number)
    const b = right.split('.').map(Number)
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
  })
  return versions.at(-1) ?? null
}

async function latestOrcaStableVersion() {
  const release = await github('/repos/stablyai/orca/releases/latest')
  return parseStableVersion(release?.tag_name ?? '') ?? highestLocalStableVersion()
}

function resolveSource(sourceRef, channel) {
  if (!gitSucceeds(['remote', 'get-url', 'upstream'])) {
    git(['remote', 'add', 'upstream', 'https://github.com/stablyai/orca.git'])
  }
  git(['fetch', '--no-prune-tags', 'origin', '+refs/heads/*:refs/remotes/origin/*'])
  git(['fetch', '--no-prune-tags', 'origin', 'refs/tags/*:refs/tags/*'])
  git(['fetch', '--no-prune-tags', 'upstream', 'main'])
  gitSucceeds(['fetch', '--no-prune-tags', 'upstream', 'refs/tags/v*:refs/tags/v*'])
  let sourceSha
  if (/^[a-f0-9]{40}$/.test(sourceRef)) {
    sourceSha = git(['rev-parse', `${sourceRef}^{commit}`])
  } else {
    if (!sourceRef || sourceRef.startsWith('-')) {
      throw new Error(`Invalid source branch: ${sourceRef}`)
    }
    git(['check-ref-format', '--branch', sourceRef])
    sourceSha = git(['rev-parse', `refs/remotes/origin/${sourceRef}^{commit}`])
  }
  const mainSha = git(['rev-parse', 'refs/remotes/origin/main'])
  if (channel === 'stable' && sourceSha !== mainSha) {
    throw new Error('Stable releases must use current origin/main')
  }
  if (channel === 'beta' && sourceSha === mainSha) {
    throw new Error('Beta releases must not use current origin/main')
  }
  const remoteBranches = git(['branch', '-r', '--contains', sourceSha])
  if (!remoteBranches.split('\n').some((line) => line.trim().startsWith('origin/'))) {
    throw new Error(`Source is not reachable from an origin branch: ${sourceSha}`)
  }
  return sourceSha
}

function findVersion(channel, sourceSha, core) {
  const pattern = channel === 'stable' ? stableTag : betaTag
  const tags = git(['tag', '--list', channel === 'stable' ? 'v*-horca.*' : 'v*-horca-beta.*'])
    .split('\n')
    .filter((tag) => pattern.test(tag))
  const existing = tags.find((tag) => git(['rev-list', '-n', '1', tag]) === sourceSha)
  if (existing) {
    return existing
  }
  const numbers = tags.flatMap((tag) => {
    const match = tag.match(pattern)
    return match && `${match[1]}.${match[2]}.${match[3]}` === core ? [Number(match[4])] : []
  })
  return `v${core}-${channel === 'stable' ? 'horca' : 'horca-beta'}.${Math.max(0, ...numbers) + 1}`
}

async function github(path) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  if (process.env.GH_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GH_TOKEN}`
  }
  const response = await fetch(`https://api.github.com${path}`, {
    headers
  })
  if (response.status === 404) {
    return undefined
  }
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${path}`)
  }
  return response.json()
}

async function metadata() {
  const channel = process.env.CHANNEL
  if (!['stable', 'beta'].includes(channel)) {
    throw new Error(`Invalid channel: ${channel}`)
  }
  const sourceSha = resolveSource(process.env.SOURCE_REF, channel)
  const sourceVersion = packageVersion(sourceSha)
  const orcaStableVersion = await latestOrcaStableVersion()
  const core = selectReleaseCore(sourceVersion, orcaStableVersion)
  if (!core) {
    throw new Error(`Cannot derive release core from ${sourceVersion}`)
  }
  const upstreamSha = git(['merge-base', 'upstream/main', sourceSha])
  const tag = findVersion(channel, sourceSha, core)
  const release = await github(`/repos/${process.env.GITHUB_REPOSITORY}/releases/tags/${tag}`)
  if (release && release.target_commitish !== sourceSha) {
    const taggedSha = git(['rev-list', '-n', '1', tag])
    if (taggedSha !== sourceSha) {
      throw new Error(`${tag} points to ${taggedSha}, not ${sourceSha}`)
    }
  }
  output('channel', channel)
  output('prerelease', String(channel === 'beta'))
  output('tag', tag)
  output('version', tag.slice(1))
  output('source_sha', sourceSha)
  output('upstream_sha', upstreamSha)
  output('upstream_version', orcaStableVersion ?? packageVersion(upstreamSha))
  output('published', String(Boolean(release && !release.draft)))
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function manifest(directory) {
  const channel = process.env.CHANNEL
  const names = ['horca-macos-arm64.dmg', 'horca-macos-x64.dmg']
  if (channel === 'beta') {
    names.push('horca-windows-x64-setup.exe')
  }
  const artifacts = names.map((name) => {
    const path = join(directory, name)
    const macos = name.includes('macos')
    return {
      name,
      platform: macos ? 'macos' : 'windows',
      arch: name.includes('arm64') ? 'arm64' : 'x64',
      size: statSync(path).size,
      sha256: sha256(path),
      signed: macos,
      notarized: macos
    }
  })
  const release = {
    schemaVersion: 1,
    channel,
    tag: process.env.TAG,
    version: process.env.VERSION,
    sourceSha: process.env.SOURCE_SHA,
    upstreamSha: process.env.UPSTREAM_SHA,
    upstreamVersion: process.env.UPSTREAM_VERSION,
    runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    artifacts
  }
  writeFileSync(join(directory, 'horca-release.json'), `${JSON.stringify(release, null, 2)}\n`)
  writeFileSync(
    join(directory, 'SHA256SUMS'),
    `${artifacts.map((item) => `${item.sha256}  ${item.name}`).join('\n')}\n`
  )
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'metadata') {
    await metadata()
  } else if (command === 'manifest') {
    manifest(...args)
  } else {
    throw new Error(`Unknown command: ${command}`)
  }
}
