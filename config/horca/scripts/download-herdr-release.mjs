#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdtempSync,
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

function assetName(version, platform = process.platform, architecture = process.arch) {
  const osName =
    platform === 'darwin'
      ? 'macos'
      : platform === 'linux'
        ? 'linux'
        : platform === 'win32'
          ? 'windows'
          : null
  const archName = architecture === 'x64' ? 'x86_64' : architecture === 'arm64' ? 'aarch64' : null
  if (!osName || !archName) {
    throw new Error(`No Herdr ${version} asset for ${platform}/${architecture}`)
  }
  if (osName === 'windows') {
    if (architecture !== 'x64') {
      throw new Error(`No pinned Windows Herdr asset for ${architecture}`)
    }
    return 'herdr-windows-x86_64.zip'
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

function option(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function extractWindowsArchive(archive, cacheRoot, version) {
  const destination = join(cacheRoot, version, 'herdr-windows-x86_64')
  const executable = join(destination, 'herdr.exe')
  if (existsSync(executable)) {
    return executable
  }
  mkdirSync(dirname(destination), { recursive: true })
  const temporary = mkdtempSync(join(dirname(destination), '.windows-'))
  try {
    execFileSync('tar', ['-xf', archive, '-C', temporary])
    renameSync(temporary, destination)
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true })
    throw error
  }
  if (!existsSync(executable)) {
    throw new Error(`Herdr Windows archive did not contain herdr.exe: ${archive}`)
  }
  return executable
}

function stageBundle(executable, platform, destination) {
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  if (platform === 'win32') {
    cpSync(dirname(executable), destination, { recursive: true })
    return join(destination, 'herdr.exe')
  }
  const staged = join(destination, 'herdr')
  copyFileSync(executable, staged)
  chmodSync(staged, 0o755)
  return staged
}

async function main() {
  const pin = loadPin()
  const platform = option('--platform') ?? process.platform
  const architecture = option('--arch') ?? process.arch
  const stage = option('--stage')
  const releaseTag = typeof pin.tag === 'string' && pin.tag.length > 0 ? pin.tag : `v${pin.version}`
  const cacheKey = typeof pin.tag === 'string' && pin.tag.length > 0 ? pin.tag : pin.version
  const asset = assetName(pin.version, platform, architecture)
  const cacheRoot =
    process.env.HORCA_HERDR_BINARY_CACHE ?? join(homedir(), '.cache', 'horca', 'herdr')
  const destination = join(cacheRoot, cacheKey, asset)
  const expectedSha256 = pin.sha256?.[asset]
  if (typeof expectedSha256 !== 'string') {
    throw new Error(`No SHA-256 pin for ${asset}`)
  }
  const url = `https://github.com/${HERDR_RELEASE_REPO}/releases/download/${releaseTag}/${asset}`
  const downloaded = await download(url, destination, expectedSha256)
  const executable =
    platform === 'win32' ? extractWindowsArchive(downloaded, cacheRoot, cacheKey) : downloaded
  process.stdout.write(`${stage ? stageBundle(executable, platform, stage) : executable}\n`)
}

main().catch((error) => {
  console.error(`[herdr-release] ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
