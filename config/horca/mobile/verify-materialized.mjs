#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
const mobileRoot = resolve(repoRoot, 'out', 'horca-mobile', 'mobile')
const required = [
  'packages/libghostty-terminal/package.json',
  'src/terminal/terminal-state.ts',
  'patches/react-native@0.86.3.patch'
]
const forbidden = [
  'src/terminal/TerminalWebView.tsx',
  'src/terminal/terminal-webview-html.ts',
  'patches/react-native@0.83.9.patch'
]

for (const path of required) {
  if (!existsSync(resolve(mobileRoot, path))) {
    throw new Error(`Missing materialized Horca mobile file: ${path}`)
  }
}
for (const path of forbidden) {
  if (existsSync(resolve(mobileRoot, path))) {
    throw new Error(`Legacy Orca mobile file survived materialization: ${path}`)
  }
}

const packageJson = JSON.parse(readFileSync(resolve(mobileRoot, 'package.json'), 'utf8'))
const appJson = JSON.parse(readFileSync(resolve(mobileRoot, 'app.json'), 'utf8'))
const expoConfig = appJson.expo
if (
  expoConfig?.name !== 'Horca' ||
  expoConfig?.slug !== 'horca-mobile' ||
  expoConfig?.scheme !== 'horca' ||
  expoConfig?.ios?.bundleIdentifier !== 'com.rudironsoni.horca' ||
  expoConfig?.android?.package !== 'com.rudironsoni.horca'
) {
  throw new Error('Materialized Horca mobile app identity is incorrect')
}
if (packageJson.name !== 'horca-mobile') {
  throw new Error('Materialized Horca mobile package name is incorrect')
}
const releaseAppfile = readFileSync(resolve(mobileRoot, 'fastlane/Appfile'), 'utf8')
const releaseFastfile = readFileSync(resolve(mobileRoot, 'fastlane/Fastfile'), 'utf8')
if (
  !releaseAppfile.includes('com.rudironsoni.horca') ||
  !releaseFastfile.includes('Horca.xcworkspace') ||
  !releaseFastfile.includes('BUNDLE_ID = "com.rudironsoni.horca"')
) {
  throw new Error('Materialized Horca mobile release identity is incorrect')
}
if (
  packageJson.dependencies?.['@orca/libghostty-terminal'] !== 'file:./packages/libghostty-terminal'
) {
  throw new Error('Materialized Horca mobile does not use the Ghostty terminal package')
}
if (
  packageJson.dependencies?.['react-native'] !== '0.86.3' ||
  packageJson.dependencies?.expo !== '~57.0.18'
) {
  throw new Error('Materialized Horca mobile dependency versions are incorrect')
}

console.log('Horca mobile materialization verified')
