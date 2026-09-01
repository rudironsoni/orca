import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import {
  configHomeDir,
  isolatedStockHerdrHomeEnv,
  resolveProtocolCompatibleHerdrTestBinary
} from './herdr-stock-binary'
import { afterAll, describe, expect, it } from 'vitest'
import { localHerdrCommand } from './herdr-cli-session'
import { SUPPORTED_HERDR_PROTOCOLS } from './herdr-runtime-contract'
import { HerdrSdkHost } from './herdr-sdk-host'
import { HerdrSdkRuntime } from './herdr-sdk-runtime'
import { fromOption } from './herdr-sdk-values'

const binary = resolveProtocolCompatibleHerdrTestBinary(SUPPORTED_HERDR_PROTOCOLS)
const describeRealHerdr = binary ? describe : describe.skip

describeRealHerdr('stock Herdr runtime integration', () => {
  const configHome = configHomeDir()
  const sessionName = `ot-${process.pid}-rt`
  const env = isolatedStockHerdrHomeEnv(configHome)
  const previousXdg = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = env.XDG_CONFIG_HOME
  const sdk = new HerdrSdkRuntime({
    application: { name: 'horca', version: 'test' },
    resolveTarget: (name) => ({ sessionName: name })
  })
  const transport = new HerdrSdkHost({
    sdk,
    commandFor: localHerdrCommand(binary as string, env),
    timeoutMs: 30_000
  })

  afterAll(async () => {
    try {
      execFileSync(binary as string, ['session', 'stop', sessionName, '--json'], {
        env,
        stdio: 'ignore',
        timeout: 30_000
      })
    } catch {
      // Session never started.
    } finally {
      await transport.disconnect()
      if (previousXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME
      } else {
        process.env.XDG_CONFIG_HOME = previousXdg
      }
      rmSync(configHome, { recursive: true, force: true })
    }
  })

  it('starts a named server and reports metadata through the SDK', async () => {
    await transport.ensureSession(sessionName)
    const created = await transport.sdk.run(sessionName, (herdr) =>
      herdr.workspaces.create({
        cwd: configHome,
        label: 'Orca integration',
        focus: false
      })
    )
    await transport.sdk.run(sessionName, (herdr) =>
      herdr.workspaces.reportMetadata(created.workspace.id, {
        source: 'orca',
        tokens: { orca_binding: 'workspace-binding' }
      })
    )
    await transport.sdk.run(sessionName, (herdr) =>
      herdr.panes.reportMetadata(created.rootPane.id, {
        source: 'orca',
        tokens: { orca_binding: 'pane-binding' }
      })
    )
    const snapshot = await transport.sdk.run(sessionName, (herdr) => herdr.session.snapshot())
    expect(SUPPORTED_HERDR_PROTOCOLS).toContain(snapshot.protocol)
    expect(
      snapshot.workspaces.find((workspace) => workspace.id === created.workspace.id)?.tokens
    ).toMatchObject({ orca_binding: 'workspace-binding' })
    expect(snapshot.panes.find((pane) => pane.id === created.rootPane.id)?.tokens).toMatchObject({
      orca_binding: 'pane-binding'
    })
  }, 30_000)

  it('echoes input through panes.sendText and panes.read', async () => {
    await transport.ensureSession(sessionName)
    const created = await transport.sdk.run(sessionName, (herdr) =>
      herdr.workspaces.create({
        cwd: configHome,
        label: 'Orca io',
        focus: false
      })
    )
    const marker = `STOCK_IO_${process.pid}`
    await transport.sdk.run(sessionName, (herdr) =>
      herdr.panes.sendText(created.rootPane.id, `echo ${marker}`)
    )
    await transport.sdk.run(sessionName, (herdr) =>
      herdr.panes.sendKeys(created.rootPane.id, ['Enter'])
    )
    const deadline = Date.now() + 10_000
    let text = ''
    while (Date.now() < deadline) {
      const read = await transport.sdk.run(sessionName, (herdr) =>
        herdr.panes.read(created.rootPane.id, { source: 'recent', lines: 80 })
      )
      text = read.text
      if (text.includes(marker)) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(text).toContain(marker)
    expect(fromOption(created.rootPane.cwd) ?? configHome).toBeTruthy()
  }, 30_000)
})
