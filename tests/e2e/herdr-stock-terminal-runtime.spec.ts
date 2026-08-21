import { execFileSync } from 'node:child_process'
import { expect, test } from './helpers/orca-app'
import {
  assertLiveHerdrTerminal,
  createStockHerdrXdgHome,
  openHerdrProjectTerminal,
  removeStockHerdrXdgHome,
  resolvePinnedHerdrBinary,
  selectHerdrInSettings,
  stockHerdrLaunchEnv
} from './helpers/herdr-terminal-runtime'
import { waitForSessionReady } from './helpers/store'

test.describe.configure({ mode: 'serial' })

const stockBinary = resolvePinnedHerdrBinary()
const stockXdgHome = stockBinary ? createStockHerdrXdgHome() : ''

test.skip(
  process.platform === 'win32' || !stockBinary,
  'pinned stock herdr binary is unavailable on this host'
)

test.use({
  seedTestRepo: false,
  orcaAppExtraEnv: stockBinary ? stockHerdrLaunchEnv(stockBinary, stockXdgHome) : {}
})

function stopStockHerdrSession(): void {
  if (!stockBinary || !stockXdgHome) {
    return
  }
  try {
    execFileSync(stockBinary, ['session', 'stop', 'orca', '--json'], {
      env: { ...process.env, XDG_CONFIG_HOME: stockXdgHome, XDG_RUNTIME_DIR: stockXdgHome },
      timeout: 10_000,
      stdio: 'ignore'
    })
  } catch {
    // Session never started.
  }
}

test.afterEach(() => {
  stopStockHerdrSession()
})

test.afterAll(() => {
  stopStockHerdrSession()
  if (stockXdgHome) {
    removeStockHerdrXdgHome(stockXdgHome)
  }
})

test('settings selects stock Herdr and opens a bound herdr terminal', async ({
  orcaPage,
  testRepoPath
}) => {
  await waitForSessionReady(orcaPage)
  await selectHerdrInSettings(orcaPage, {
    binaryPath: stockBinary ?? undefined
  })
  await openHerdrProjectTerminal(orcaPage, testRepoPath)
  const marker = { prefix: `STOCK_E2E_${process.pid}_`, suffix: 'LIVE' }
  await assertLiveHerdrTerminal(orcaPage, marker)
  await expect(orcaPage.locator('.xterm-rows').first()).toContainText(
    `${marker.prefix}${marker.suffix}`
  )
})
