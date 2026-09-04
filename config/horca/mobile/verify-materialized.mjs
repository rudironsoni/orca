#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
const mobileRoot = resolve(repoRoot, 'out', 'horca-mobile', 'mobile')
const required = [
  'packages/libghostty-terminal/package.json',
  'plugins/ios-scene-lifecycle.js',
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
  expoConfig?.ios?.bundleIdentifier !== 'com.rudironsoni.horca.mobile' ||
  expoConfig?.android?.package !== 'com.rudironsoni.horca'
) {
  throw new Error('Materialized Horca mobile app identity is incorrect')
}
if (packageJson.name !== 'horca-mobile') {
  throw new Error('Materialized Horca mobile package name is incorrect')
}
if (!expoConfig.plugins?.includes('./plugins/ios-scene-lifecycle.js')) {
  throw new Error('Materialized Horca mobile does not enable the iOS scene lifecycle')
}
const releaseAppfile = readFileSync(resolve(mobileRoot, 'fastlane/Appfile'), 'utf8')
const releaseFastfile = readFileSync(resolve(mobileRoot, 'fastlane/Fastfile'), 'utf8')
if (
  !releaseAppfile.includes('com.rudironsoni.horca.mobile') ||
  !releaseFastfile.includes('Horca.xcworkspace') ||
  !releaseFastfile.includes('BUNDLE_ID = "com.rudironsoni.horca.mobile"')
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
  packageJson.dependencies?.expo !== '~57.0.18' ||
  packageJson.dependencies?.['react-native-webview'] !== '13.16.1' ||
  packageJson.devDependencies?.['@types/react-native'] !== undefined ||
  packageJson.devDependencies?.['expo-module-scripts'] !== undefined ||
  packageJson.packageManager !== 'pnpm@12.0.0'
) {
  throw new Error('Materialized Horca mobile dependency versions are incorrect')
}

const lockfile = readFileSync(resolve(mobileRoot, 'pnpm-lock.yaml'), 'utf8')
const deprecatedPackages = [
  '@types/react-native@0.73.0',
  'eslint@9.39.4',
  '@xmldom/xmldom@0.8.13',
  '@xmldom/xmldom@0.9.10',
  'abab@2.0.6',
  'domexception@4.0.0',
  'glob@7.2.3',
  'inflight@1.0.6',
  'rimraf@3.0.2',
  'whatwg-encoding@2.0.0'
]
for (const packageVersion of deprecatedPackages) {
  if (lockfile.includes(packageVersion)) {
    throw new Error(`Deprecated package survived Horca mobile materialization: ${packageVersion}`)
  }
}

console.log('Horca mobile materialization verified')
