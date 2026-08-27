'use strict'

const { chmodSync, existsSync, symlinkSync, lstatSync, unlinkSync } = require('node:fs')
const { join, resolve } = require('node:path')

// Why a post-processor instead of inlining identity through electron-builder.config.cjs:
// that file churns on every packaging tweak, and leftover Horca hunks are what
// made Shepherd conflict on main. Official builds must keep the upstream object
// byte-for-byte except the wrap at the bottom of that file.

function isDownstreamBuild() {
  return process.env.ORCA_DOWNSTREAM_BUILD === '1'
}

function horcaIdentity() {
  return require('../src/shared/distribution-identity.json').horca
}

function rewriteResourceDest(resources, fromEndsWith, to) {
  if (!Array.isArray(resources)) {
    return
  }
  for (const resource of resources) {
    if (resource && typeof resource.from === 'string' && resource.from.endsWith(fromEndsWith)) {
      resource.to = to
    }
  }
}

function rewriteComputerUseHelper(resources, productName) {
  if (!Array.isArray(resources)) {
    return
  }
  const renamed = `${productName} Computer Use.app`
  for (const resource of resources) {
    if (
      resource &&
      typeof resource.from === 'string' &&
      resource.from.endsWith('Orca Computer Use.app')
    ) {
      resource.from = resource.from.replace(/Orca Computer Use\.app$/, renamed)
      resource.to = renamed
    }
  }
}

function rewriteUsageDescriptions(extendInfo, productName) {
  if (!extendInfo) {
    return
  }
  for (const [key, value] of Object.entries(extendInfo)) {
    if (typeof value === 'string' && value.startsWith('Orca ')) {
      extendInfo[key] = `${productName}${value.slice('Orca'.length)}`
    }
  }
}

function packagedResourcesDir(context) {
  return context.electronPlatformName === 'darwin'
    ? join(
        context.appOutDir,
        `${context.packager.appInfo.productFilename}.app`,
        'Contents',
        'Resources'
      )
    : join(context.appOutDir, 'resources')
}

function wrapAfterPack(originalAfterPack, identity) {
  return async (context) => {
    const resourcesDir = packagedResourcesDir(context)
    const officialHelper = join(resourcesDir, 'Orca Computer Use.app')
    const downstreamHelper = join(resourcesDir, `${identity.productName} Computer Use.app`)
    // afterPack still signs the upstream helper name; alias so that path exists.
    const aliased =
      context.electronPlatformName === 'darwin' &&
      existsSync(resourcesDir) &&
      existsSync(downstreamHelper) &&
      !existsSync(officialHelper)
    if (aliased) {
      symlinkSync(downstreamHelper, officialHelper)
    }
    try {
      if (typeof originalAfterPack === 'function') {
        await originalAfterPack(context)
      }
    } finally {
      if (aliased && existsSync(officialHelper) && lstatSync(officialHelper).isSymbolicLink()) {
        unlinkSync(officialHelper)
      }
    }
    if (context.electronPlatformName === 'win32') {
      return
    }
    const launcherPath = join(resourcesDir, 'bin', identity.publicCli)
    if (existsSync(launcherPath)) {
      chmodSync(launcherPath, 0o755)
    }
  }
}

function applyDownstreamDistribution(config) {
  if (!isDownstreamBuild()) {
    return config
  }

  const identity = horcaIdentity()
  config.appId = identity.appId
  config.productName = identity.productName
  config.protocols = [{ name: identity.productName, schemes: [identity.protocol] }]

  const localBuildVersion = process.env.ORCA_LOCAL_BUILD_VERSION
  if (localBuildVersion) {
    config.extraMetadata = { version: localBuildVersion }
  }

  if (config.win) {
    config.win.executableName = identity.productName
    config.win.verifyUpdateCodeSignature = false
    delete config.win.signtoolOptions
    rewriteResourceDest(config.win.extraResources, 'orca.cmd', `bin/${identity.publicCli}.cmd`)
    rewriteResourceDest(config.win.extraResources, 'orca.exe', `bin/${identity.publicCli}.exe`)
  }

  if (config.nsis) {
    config.nsis.artifactName = 'horca-windows-x64-setup.${ext}'
    config.nsis.include = resolve(__dirname, 'nsis', 'daemon-host-uninstall-horca.nsh')
  }

  if (config.mac) {
    rewriteUsageDescriptions(config.mac.extendInfo, identity.productName)
    rewriteResourceDest(config.mac.extraResources, 'bin/orca', `bin/${identity.publicCli}`)
    rewriteComputerUseHelper(config.mac.extraResources, identity.productName)
  }

  if (config.dmg) {
    config.dmg.artifactName = 'horca-macos-${arch}.${ext}'
  }

  if (config.linux) {
    config.linux.executableName = identity.linuxExecutableName
    const linuxDesktop = config.linux.desktop || { entry: {} }
    const linuxDesktopEntry = linuxDesktop.entry || {}
    config.linux.desktop = Object.assign({}, linuxDesktop, {
      entry: Object.assign({}, linuxDesktopEntry, {
        StartupWMClass: identity.linuxStartupWmClass
      })
    })
    rewriteResourceDest(
      config.linux.extraResources,
      'linux/bin/orca-ide',
      `bin/${identity.publicCli}`
    )
    if (Array.isArray(config.linux.extraResources)) {
      for (const resource of config.linux.extraResources) {
        if (
          resource &&
          typeof resource.from === 'string' &&
          resource.from.endsWith('linux/bin/orca-ide')
        ) {
          resource.from = resolve(__dirname, '..', 'resources', 'linux', 'bin', identity.publicCli)
        }
      }
    }
  }

  if (config.appImage) {
    config.appImage.artifactName = 'horca-linux-${arch}.${ext}'
  }

  if (config.deb) {
    config.deb.packageName = identity.linuxPackageName
    config.deb.artifactName = 'horca-ide_${version}_${arch}.${ext}'
    config.deb.afterInstall = resolve(__dirname, 'linux', 'after-install-horca.sh')
    config.deb.afterRemove = resolve(__dirname, 'linux', 'after-remove-horca.sh')
  }

  if (config.rpm) {
    config.rpm.packageName = identity.linuxPackageName
    config.rpm.artifactName = 'horca-ide-${version}.${arch}.${ext}'
    config.rpm.afterInstall = resolve(__dirname, 'linux', 'after-install-horca.sh')
    config.rpm.afterRemove = resolve(__dirname, 'linux', 'after-remove-horca.sh')
  }

  config.publish = null
  config.afterPack = wrapAfterPack(config.afterPack, identity)
  return config
}

module.exports = { applyDownstreamDistribution }
