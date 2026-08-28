#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  buildWindowsIcoFromPng,
  decodePng,
  encodePng
} from '../scripts/trim-windows-icon-source.mjs'

const projectRoot = resolve(import.meta.dirname, '..', '..')
const sourcePath = join(projectRoot, 'resources', 'build', 'icon.png')
const outputDirectory = join(projectRoot, 'resources', 'horca', 'build')

function setPixel(image, x, y, color) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    return
  }
  const offset = (y * image.width + x) * 4
  image.data[offset] = color[0]
  image.data[offset + 1] = color[1]
  image.data[offset + 2] = color[2]
  image.data[offset + 3] = color[3]
}

function drawBadge(image) {
  const radius = Math.round(image.width * 0.145)
  const centerX = image.width - radius - Math.round(image.width * 0.045)
  const centerY = image.height - radius - Math.round(image.height * 0.045)
  const border = Math.max(4, Math.round(image.width * 0.012))
  for (let y = centerY - radius; y <= centerY + radius; y++) {
    for (let x = centerX - radius; x <= centerX + radius; x++) {
      const distance = Math.hypot(x - centerX, y - centerY)
      if (distance <= radius) {
        setPixel(
          image,
          x,
          y,
          distance >= radius - border ? [17, 17, 17, 255] : [255, 255, 255, 255]
        )
      }
    }
  }

  const stroke = Math.max(4, Math.round(radius * 0.18))
  const halfWidth = Math.round(radius * 0.48)
  const halfHeight = Math.round(radius * 0.55)
  for (let y = centerY - halfHeight; y <= centerY + halfHeight; y++) {
    for (let x = centerX - halfWidth; x <= centerX + halfWidth; x++) {
      const left = x < centerX - halfWidth + stroke
      const right = x > centerX + halfWidth - stroke
      const middle = Math.abs(y - centerY) < Math.ceil(stroke / 2)
      if (left || right || middle) {
        setPixel(image, x, y, [17, 17, 17, 255])
      }
    }
  }
  return image
}

function writeMacIcon() {
  if (process.platform !== 'darwin') {
    throw new Error('Horca icon.icns generation requires macOS iconutil')
  }
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'horca-icons-'))
  const iconPackage = join(temporaryDirectory, 'Horca.icon')
  const assetsDirectory = join(iconPackage, 'Assets')
  mkdirSync(assetsDirectory, { recursive: true })
  copyFileSync(
    join(projectRoot, 'resources', 'icon-source', 'icon.icon', 'icon.json'),
    join(iconPackage, 'icon.json')
  )
  copyFileSync(
    join(projectRoot, 'resources', 'horca', 'logo.svg'),
    join(assetsDirectory, 'logo.svg')
  )
  try {
    execFileSync('xcrun', [
      'actool',
      '--compile',
      temporaryDirectory,
      '--platform',
      'macosx',
      '--minimum-deployment-target',
      '10.12',
      '--app-icon',
      'Horca',
      '--output-partial-info-plist',
      join(temporaryDirectory, 'partial.plist'),
      iconPackage
    ])
    copyFileSync(join(temporaryDirectory, 'Horca.icns'), join(outputDirectory, 'icon.icns'))
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true })
  }
}

mkdirSync(outputDirectory, { recursive: true })
const badgedImage = drawBadge(decodePng(readFileSync(sourcePath)))
const badgedPng = encodePng(badgedImage)
writeFileSync(join(outputDirectory, 'icon.png'), badgedPng)
writeFileSync(join(outputDirectory, 'icon.ico'), buildWindowsIcoFromPng(badgedPng))
writeMacIcon()
console.log(`Generated Horca icons in ${outputDirectory}`)
