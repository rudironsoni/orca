#!/usr/bin/env node
// Why: download the pinned stock herdr release for the current host so the
// stock-runtime e2e can run against a real, version-pinned binary instead of
// building from source. Prints the resolved binary path to stdout for
// `ORCA_HERDR_TEST_BINARY=$(node config/scripts/download-herdr-release.mjs)`.
//
// The version/protocol/schema pin lives in config/herdr-version.json and is
// cross-checked against the runtime contract by herdr-version-pin.test.ts.
import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const HERDR_RELEASE_REPO = 'herdrdev/herdr'

function repoRoot() {
  return join(import.meta.dirname, '..', '..')
}

function loadPin() {
  const raw = readFileSync(join(repoRoot(), 'config', 'herdr-version.json'), 'utf8')
  return JSON.parse(raw)
}

function assetNameForHost(version) {
  const platform = process.platform
  const arch = process.arch
  const osName =
    platform === 'darwin'
      ? 'macos'
      : platform === 'linux'
        ? 'linux'
        : platform === 'win32'
          ? 'windows'
          : null
  const archName = arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : null
  if (!osName || !archName) {
    throw new Error(`No herdr ${version} asset for ${platform}/${arch}`)
  }
  if (osName === 'windows') {
    throw new Error('Windows herdr asset acquisition is implemented in the Windows stacked PR')
  }
  return `herdr-${osName}-${archName}`
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

async function isVerified(path, expectedSha256) {
  return existsSync(path) && (await sha256(path)) === expectedSha256
}

async function download(url, destPath, expectedSha256) {
  mkdirSync(dirname(destPath), { recursive: true })
  if (await isVerified(destPath, expectedSha256)) {
    return destPath
  }
  rmSync(destPath, { force: true })
  const tempPath = `${destPath}.${process.pid}-${randomUUID()}.tmp`
  try {
    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok || !response.body) {
      throw new Error(`Download failed (${response.status}) for ${url}`)
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath, { flags: 'wx' }))
    const actualSha256 = await sha256(tempPath)
    if (actualSha256 !== expectedSha256) {
      throw new Error(
        `SHA-256 mismatch for ${url}: expected ${expectedSha256}, received ${actualSha256}`
      )
    }
    if (process.platform !== 'win32') {
      chmodSync(tempPath, 0o755)
    }
    renameSync(tempPath, destPath)
  } catch (error) {
    rmSync(tempPath, { force: true })
    throw error
  }
  return destPath
}

async function main() {
  const pin = loadPin()
  const asset = assetNameForHost(pin.version)
  const cacheRoot =
    process.env.ORCA_HERDR_BINARY_CACHE ?? join(homedir(), '.cache', 'orca', 'herdr')
  const destPath = join(cacheRoot, pin.version, asset)
  const expectedSha256 = pin.sha256?.[asset]
  if (typeof expectedSha256 !== 'string') {
    throw new Error(`No SHA-256 pin for ${asset}`)
  }
  const url = `https://github.com/${HERDR_RELEASE_REPO}/releases/download/v${pin.version}/${asset}`
  const resolved = await download(url, destPath, expectedSha256)
  process.stdout.write(`${resolved}\n`)
}

main().catch((error) => {
  console.error(`[herdr-release] ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
