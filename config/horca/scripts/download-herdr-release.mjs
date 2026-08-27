#!/usr/bin/env node
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
  return join(import.meta.dirname, '..', '..', '..')
}

function loadPin() {
  return JSON.parse(readFileSync(join(repoRoot(), 'config', 'horca', 'herdr-version.json'), 'utf8'))
}

function assetNameForHost(version) {
  const osName =
    process.platform === 'darwin'
      ? 'macos'
      : process.platform === 'linux'
        ? 'linux'
        : process.platform === 'win32'
          ? 'windows'
          : null
  const archName = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : null
  if (!osName || !archName) {
    throw new Error(`No Herdr ${version} asset for ${process.platform}/${process.arch}`)
  }
  if (osName === 'windows') {
    throw new Error('No pinned Windows Herdr asset is available')
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

async function download(url, destination, expectedSha256) {
  mkdirSync(dirname(destination), { recursive: true })
  if (existsSync(destination) && (await sha256(destination)) === expectedSha256) {
    return destination
  }
  rmSync(destination, { force: true })
  const temporary = `${destination}.${process.pid}-${randomUUID()}.tmp`
  try {
    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok || !response.body) {
      throw new Error(`Download failed (${response.status}) for ${url}`)
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }))
    const actualSha256 = await sha256(temporary)
    if (actualSha256 !== expectedSha256) {
      throw new Error(
        `SHA-256 mismatch for ${url}: expected ${expectedSha256}, received ${actualSha256}`
      )
    }
    chmodSync(temporary, 0o755)
    renameSync(temporary, destination)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
  return destination
}

async function main() {
  const pin = loadPin()
  const asset = assetNameForHost(pin.version)
  const cacheRoot =
    process.env.HORCA_HERDR_BINARY_CACHE ?? join(homedir(), '.cache', 'horca', 'herdr')
  const destination = join(cacheRoot, pin.version, asset)
  const expectedSha256 = pin.sha256?.[asset]
  if (typeof expectedSha256 !== 'string') {
    throw new Error(`No SHA-256 pin for ${asset}`)
  }
  const url = `https://github.com/${HERDR_RELEASE_REPO}/releases/download/v${pin.version}/${asset}`
  process.stdout.write(`${await download(url, destination, expectedSha256)}\n`)
}

main().catch((error) => {
  console.error(`[herdr-release] ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
