import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const buildScript = fileURLToPath(new URL('./run-electron-vite-build.mjs', import.meta.url))
// Keep this wrapper CommonJS (the `.cts` extension) so electron-vite can load
// each parallel target without sharing its timestamp-named ESM temp file.
const targetConfig = fileURLToPath(new URL('../electron-vite-target.config.cts', import.meta.url))
const targets = ['main', 'preload', 'renderer']

function buildTarget(target) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [buildScript, '--config', targetConfig, '--ignoreConfigWarning'],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          ORCA_ELECTRON_VITE_TARGET: target
        }
      }
    )

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Electron Vite ${target} build exited with signal ${signal}`))
      } else if (code !== 0) {
        reject(new Error(`Electron Vite ${target} build exited with code ${code}`))
      } else {
        resolve()
      }
    })
  })
}

export async function runElectronViteTargets(options = {}) {
  const platform = options.platform ?? process.platform
  const runTarget = options.runTarget ?? buildTarget
  if (platform !== 'win32') {
    return Promise.allSettled(targets.map(runTarget))
  }

  const results = []
  // electron-vite's timestamped config bundle is process-shared on Windows.
  for (const target of targets) {
    results.push(...(await Promise.allSettled([runTarget(target)])))
  }
  return results
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const results = await runElectronViteTargets()
  const failures = results.filter((result) => result.status === 'rejected')

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(failure.reason)
    }
    process.exit(1)
  }
}
