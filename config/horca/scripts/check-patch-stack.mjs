#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const policy = JSON.parse(
  readFileSync(join(repoRoot, 'config', 'horca', 'patch-stack.json'), 'utf8')
)
const upstreamRef = process.env.HORCA_UPSTREAM_REF || policy.upstreamRef

function git(args, input) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...(input === undefined ? {} : { input })
  })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`)
  }
  return result.stdout.trim()
}

function patchId(commit) {
  const patch = git(['show', '--pretty=format:', '--binary', commit])
  return git(['patch-id', '--stable'], patch).split(/\s+/, 1)[0]
}

const base = git(['merge-base', upstreamRef, 'HEAD'])
if (process.env.HORCA_REQUIRE_UPSTREAM_ANCESTOR === '1') {
  const upstreamSha = git(['rev-parse', upstreamRef])
  if (base !== upstreamSha) {
    throw new Error(`Candidate does not contain required upstream ${upstreamSha}`)
  }
}

const mergeCommits = git(['rev-list', '--merges', `${base}..HEAD`])
if (mergeCommits) {
  throw new Error(`Patch stack contains merge commits:\n${mergeCommits}`)
}

const commits = git(['rev-list', '--reverse', `${base}..HEAD`]).split('\n').filter(Boolean)
const patchIds = new Map(commits.map((commit) => [patchId(commit), commit]))
for (const required of policy.requiredPatches) {
  if (!patchIds.has(required.patchId)) {
    throw new Error(`Missing required patch: ${required.name} (${required.patchId})`)
  }
}

console.log(`Horca patch stack: ${commits.length} commits on ${base.slice(0, 12)}`)
for (const commit of commits) {
  console.log(`  ${commit.slice(0, 12)} ${git(['show', '-s', '--format=%s', commit])}`)
}
