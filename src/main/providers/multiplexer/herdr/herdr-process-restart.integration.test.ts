import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { herdrSessionNameForProject } from '../../../../shared/horca/herdr-session-identity'
import { herdrServerEnvironment, localHerdrCommand } from './herdr-cli-session'
import {
  configHomeDir,
  isolatedStockHerdrHomeEnv,
  resolveProtocolCompatibleHerdrTestBinary
} from './herdr-stock-binary'
import { ORCA_BINDING_TOKEN } from './herdr-binding-metadata'
import { SUPPORTED_HERDR_PROTOCOLS } from './herdr-runtime-contract'
import { HerdrRuntimeManager } from './herdr-runtime-manager'
import { HerdrSdkHost } from './herdr-sdk-host'
import { HerdrSdkRuntime } from './herdr-sdk-runtime'
import type { Project } from '../../../../shared/project-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'

const binary = resolveProtocolCompatibleHerdrTestBinary(SUPPORTED_HERDR_PROTOCOLS)
const describeRealHerdr = binary ? describe : describe.skip

async function waitForSocketRemoval(socketPath: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (existsSync(socketPath) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  expect(existsSync(socketPath)).toBe(false)
}

describeRealHerdr('stock Herdr process restart', () => {
  const configHome = configHomeDir()
  const sessionName = `ot-${process.pid}-rs`
  const env = isolatedStockHerdrHomeEnv(configHome)
  const previousXdg = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = env.XDG_CONFIG_HOME
  const socketPath = join(
    env.XDG_CONFIG_HOME as string,
    'herdr',
    'sessions',
    sessionName,
    'herdr.sock'
  )
  const sdk = new HerdrSdkRuntime({
    application: { name: 'horca', version: 'test' },
    resolveTarget: (name) => ({ sessionName: name })
  })
  const transport = new HerdrSdkHost({
    sdk,
    commandFor: localHerdrCommand(binary as string, env),
    serverCommandFor: (name) => ({
      file: binary as string,
      args: ['--session', name, 'server'],
      env: herdrServerEnvironment(env)
    }),
    timeoutMs: 90_000
  })
  const manager = new HerdrRuntimeManager(transport, () => sessionName)

  afterAll(async () => {
    try {
      execFileSync(binary as string, ['session', 'stop', sessionName, '--json'], {
        env,
        stdio: 'ignore',
        timeout: 30_000
      })
    } catch {
      // Session never started.
    }
    await transport.disconnect()
    if (previousXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = previousXdg
    }
    rmSync(configHome, { recursive: true, force: true })
  })

  it('restarts a dead stock server and reconverges the same Orca bindings', async () => {
    const project: Project = {
      id: 'project-1',
      displayName: 'Project',
      badgeColor: '#000',
      sourceRepoIds: ['repo-1'],
      createdAt: 1,
      updatedAt: 1
    }
    const tab: TerminalTab = {
      id: 'tab-1',
      ptyId: null,
      worktreeId: 'worktree-1',
      title: 'Terminal',
      customTitle: null,
      color: null,
      sortOrder: 0,
      createdAt: 1
    }
    const graph = {
      project,
      worktrees: [{ id: 'worktree-1', path: configHome, displayName: 'repo' }],
      tabsByWorktreeId: { 'worktree-1': [tab] },
      layoutsByTabId: {
        'tab-1': {
          root: {
            type: 'split' as const,
            direction: 'vertical' as const,
            ratio: 0.5,
            first: { type: 'leaf' as const, leafId: 'leaf-1' },
            second: { type: 'leaf' as const, leafId: 'leaf-2' }
          },
          activeLeafId: 'leaf-1',
          expandedLeafId: null
        }
      }
    }

    const first = await manager.reconcileProjectHost(graph)
    expect(first.workspaces).toHaveLength(1)
    expect(first.panes.filter((pane) => pane.tokens?.[ORCA_BINDING_TOKEN])).toHaveLength(2)
    const firstWorkspaceId = first.workspaces[0].id
    const session = herdrSessionNameForProject(project, sessionName)
    const firstLeaf1 = manager.getPaneId(session, project.id, 'leaf-1')
    const firstLeaf2 = manager.getPaneId(session, project.id, 'leaf-2')
    expect(firstLeaf1).toBeTruthy()
    expect(firstLeaf2).toBeTruthy()

    execFileSync(binary as string, ['session', 'stop', sessionName, '--json'], {
      env,
      stdio: 'ignore',
      timeout: 30_000
    })
    await waitForSocketRemoval(socketPath)
    await new Promise((resolve) => setTimeout(resolve, 500))

    await transport.ensureSession(sessionName)
    const restored = await transport.sdk.run(sessionName, (herdr) => herdr.session.snapshot())

    const second = await manager.reconcileProjectHost(graph)
    expect(second.workspaces).toHaveLength(1)
    expect(second.workspaces[0].id).toBe(firstWorkspaceId)
    expect(manager.getPaneId(session, project.id, 'leaf-1')).toBe(firstLeaf1)
    expect(manager.getPaneId(session, project.id, 'leaf-2')).toBe(firstLeaf2)
    expect(
      second.workspaces.filter((workspace) => workspace.tokens?.[ORCA_BINDING_TOKEN])
    ).toHaveLength(1)
    expect(restored.workspaces).toHaveLength(1)
  }, 120_000)
})
