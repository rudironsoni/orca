#!/usr/bin/env node
import { chromium } from '@stablyai/playwright-test'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const executablePath = resolve(process.argv[2] ?? '')
if (!existsSync(executablePath)) {
  throw new Error(`Packaged Horca executable does not exist: ${executablePath}`)
}

const smokeTmpRoot = process.platform === 'darwin' ? '/tmp' : tmpdir()
const root = mkdtempSync(join(smokeTmpRoot, 'hs-'))
const home = join(root, 'home')
const userData = join(root, 'user-data')
const herdrSessionName = `horca-packaged-smoke-${process.pid}`
mkdirSync(home, { recursive: true, mode: 0o700 })
mkdirSync(userData, { recursive: true, mode: 0o700 })
writeFileSync(
  join(userData, 'orca-data.json'),
  JSON.stringify({
    settings: { telemetry: { optedIn: true, installId: '00000000-0000-4000-8000-000000000000' } },
    onboarding: { flowVersion: 4, closedAt: 1, outcome: 'completed', lastCompletedStep: 5 },
    ui: {
      featureTipsSeenIds: ['voice-dictation', 'orca-cli', 'cmd-j-palette'],
      contextualToursSeenIds: [
        'workspace-board',
        'browser',
        'tasks',
        'automations',
        'workspace-creation'
      ],
      contextualToursAutoEligible: false,
      projectOrderManualDefaultNoticeDismissed: true,
      usagePercentageDisplayChangeNoticeDismissed: true
    }
  })
)

const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...inheritedEnvironment } = process.env
void _electronRunAsNode
const launchEnvironment = {
  ...inheritedEnvironment,
  HOME: home,
  USERPROFILE: home,
  ORCA_E2E_HOME_DIR: home,
  ORCA_E2E_USER_DATA_DIR: userData,
  ORCA_E2E_HEADLESS: '1'
}
async function reservePort() {
  const server = createServer()
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolveClose) => server.close(resolveClose))
  return port
}

async function waitForMainPage(context) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    for (const page of context.pages()) {
      if (
        !page.isClosed() &&
        (await page.title().catch(() => '')) === 'Horca' &&
        (await page.evaluate(() => Boolean(window.api?.horcaTerminalSettings)).catch(() => false))
      ) {
        await page.waitForTimeout(500).catch(() => undefined)
        if (
          !page.isClosed() &&
          (await page.title().catch(() => '')) === 'Horca' &&
          (await page.evaluate(() => Boolean(window.api?.horcaTerminalSettings)).catch(() => false))
        ) {
          return page
        }
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error('Packaged Horca did not create its main renderer page')
}

async function launch() {
  const port = await reservePort()
  const child = spawn(
    executablePath,
    [`--user-data-dir=${userData}`, `--remote-debugging-port=${port}`, '--remote-allow-origins=*'],
    {
      env: launchEnvironment,
      stdio: ['ignore', 'ignore', 'pipe']
    }
  )
  const endpoint = await new Promise((resolveEndpoint, rejectEndpoint) => {
    const timeout = setTimeout(
      () => rejectEndpoint(new Error('Packaged Horca did not publish a CDP endpoint')),
      20_000
    )
    child.once('exit', (code) => {
      clearTimeout(timeout)
      rejectEndpoint(new Error(`Packaged Horca exited before CDP was ready: ${code}`))
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      const match = chunk.match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) {
        clearTimeout(timeout)
        resolveEndpoint(match[1])
      }
    })
  })
  let browser
  let connectionError
  const deadline = Date.now() + 10_000
  while (!browser && Date.now() < deadline) {
    try {
      browser = await chromium.connectOverCDP(endpoint)
    } catch (error) {
      connectionError = error
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
    }
  }
  if (!browser) {
    child.kill()
    throw new Error(`Could not connect to packaged Horca CDP endpoint: ${endpoint}`, {
      cause: connectionError
    })
  }
  const context = browser.contexts()[0]
  const page = await waitForMainPage(context)
  return { browser, child, page }
}

async function stop(application) {
  await Promise.race([
    application?.browser.close().catch(() => undefined),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000))
  ])
  if (application?.child.exitCode === null) {
    application.child.kill()
    await Promise.race([
      new Promise((resolveExit) => application.child.once('exit', resolveExit)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000))
    ])
  }
}

let application
async function waitForFile(path) {
  const deadline = Date.now() + 5_000
  while (!existsSync(path) && Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
  }
}

try {
  application = await launch()
  const page = application.page
  await page.waitForLoadState('domcontentloaded')
  if ((await page.title()) !== 'Horca') {
    throw new Error(`Packaged renderer title is not Horca: ${await page.title()}`)
  }
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByText('Terminal', { exact: true }).first().click()
  await page.locator('[data-horca-settings="terminal-backend"]').waitFor({ state: 'visible' })
  await page.getByRole('radio', { name: 'Herdr', exact: true }).first().click()
  const settingsFile = join(home, '.horca', 'terminal-backends.json')
  await waitForFile(settingsFile)
  if (!existsSync(settingsFile)) {
    throw new Error(`Horca terminal settings were not written: ${settingsFile}`)
  }
  if (existsSync(join(home, '.orca'))) {
    throw new Error(`Horca created the official Orca state root: ${join(home, '.orca')}`)
  }
  await page.evaluate(
    (defaultSessionName) =>
      window.api.horcaTerminalSettings?.updateDefaults({ defaultSessionName }),
    herdrSessionName
  )
  const herdrPtyId = await page.evaluate(async (cwd) => {
    const leafId = '3f391f2e-5f1f-4ea4-8c0c-0f5e630a36ca'
    const result = await window.api.pty.spawn({
      cols: 80,
      rows: 24,
      cwd,
      env: { ORCA_PANE_KEY: `horca-packaged-smoke:${leafId}` },
      command: 'printf HORCA_HERDR_SMOKE',
      worktreeId: 'global-floating-terminal',
      tabId: 'horca-packaged-smoke',
      leafId
    })
    return result.id
  }, home)
  if (!herdrPtyId.startsWith('herdr:')) {
    throw new Error(`Packaged terminal did not use Herdr: ${herdrPtyId}`)
  }
  await page.evaluate((ptyId) => window.api.pty.kill(ptyId), herdrPtyId)
  await stop(application)
  application = await launch()
  const restartedPage = application.page
  await restartedPage.waitForLoadState('domcontentloaded')
  await restartedPage.waitForFunction(() => Boolean(window.api?.horcaTerminalSettings))
  const restartedSnapshot = await restartedPage.evaluate(() =>
    window.api.horcaTerminalSettings?.getSnapshot()
  )
  if (restartedSnapshot?.defaults.defaultBackend !== 'herdr') {
    throw new Error('Herdr selection did not survive the packaged app restart')
  }
  console.log(
    'Packaged Horca smoke passed: title, Settings > Terminal, Herdr PTY, restart, and isolated state'
  )
} finally {
  await stop(application)
  try {
    execFileSync('herdr', ['session', 'stop', herdrSessionName, '--json'], {
      env: launchEnvironment,
      stdio: 'ignore',
      timeout: 10_000
    })
  } catch {
    // The session did not start or the app already stopped it.
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(root, { force: true, recursive: true })
      break
    } catch (error) {
      if (attempt === 4) {
        console.warn(`Could not remove packaged smoke directory ${root}:`, error)
        break
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250 * (attempt + 1)))
    }
  }
}
