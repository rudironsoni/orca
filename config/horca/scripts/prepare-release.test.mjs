import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const script = new URL('./prepare-release.mjs', import.meta.url).pathname

test('writes a verifiable beta release manifest', () => {
  const directory = mkdtempSync(join(tmpdir(), 'horca-release-test-'))
  for (const name of [
    'horca-macos-arm64.dmg',
    'horca-macos-x64.dmg',
    'horca-windows-x64-setup.exe'
  ]) {
    writeFileSync(join(directory, name), name)
  }
  const result = spawnSync(process.execPath, [script, 'manifest', directory], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CHANNEL: 'beta',
      TAG: 'v1.4.178-horca-beta.1',
      VERSION: '1.4.178-horca-beta.1',
      SOURCE_SHA: 'a'.repeat(40),
      UPSTREAM_SHA: 'b'.repeat(40),
      UPSTREAM_VERSION: '1.4.178-rc.2',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'rudironsoni/horca',
      GITHUB_RUN_ID: '123'
    }
  })
  assert.equal(result.status, 0, result.stderr)

  const manifest = JSON.parse(readFileSync(join(directory, 'horca-release.json'), 'utf8'))
  assert.equal(manifest.channel, 'beta')
  assert.equal(manifest.artifacts.length, 3)
  assert.equal(manifest.artifacts[0].signed, true)
  assert.equal(manifest.artifacts[2].signed, false)
  assert.match(readFileSync(join(directory, 'SHA256SUMS'), 'utf8'), /horca-windows-x64-setup\.exe/)
})
