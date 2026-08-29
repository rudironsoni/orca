import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OrcaDistribution } from '../../../shared/distribution-identity'
import type { Store } from '../../persistence'
import {
  createHorcaTerminalSettingsSource,
  horcaTerminalSettingsPath
} from './horca-terminal-settings'

const temporaryDirectories: string[] = []
const globalWithDistribution = globalThis as { ORCA_DISTRIBUTION?: OrcaDistribution }

function makeSettingsPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'horca-settings-'))
  temporaryDirectories.push(directory)
  return horcaTerminalSettingsPath(directory)
}

function makeStore(projectIds: string[] = [], onboardingClosedAt: number | null = null): Store {
  return {
    getSettings: () => ({}),
    getOnboarding: () => ({ closedAt: onboardingClosedAt }),
    getProjects: () => projectIds.map((id) => ({ id }))
  } as unknown as Store
}

beforeEach(() => {
  globalWithDistribution.ORCA_DISTRIBUTION = 'horca'
})

afterEach(() => {
  globalWithDistribution.ORCA_DISTRIBUTION = 'official'
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Horca terminal settings', () => {
  it('defaults fresh Horca profiles to managed Herdr without changing Orca settings', () => {
    const source = createHorcaTerminalSettingsSource(makeStore(), makeSettingsPath())

    expect(source.getDefaultBackend()).toBe('herdr')
    expect(source.getHerdrSettings('local')).toEqual({
      binarySource: { kind: 'managed' },
      defaultSessionName: undefined
    })
  })

  it('reads explicit sidecar settings and persists host activation', () => {
    const settingsPath = makeSettingsPath()
    mkdirSync(dirname(settingsPath), { recursive: true })
    writeFileSync(
      settingsPath,
      JSON.stringify({
        version: 1,
        terminalBackendDefault: 'orca',
        herdr: { binarySource: { kind: 'custom', path: '/opt/herdr' } },
        projects: { project: { preference: 'herdr', sessionName: 'team' } }
      })
    )
    const source = createHorcaTerminalSettingsSource(makeStore(), settingsPath)

    expect(source.getDefaultBackend()).toBe('orca')
    expect(source.getHerdrSettings('local').binarySource).toEqual({
      kind: 'custom',
      path: '/opt/herdr'
    })
    expect(source.getProjectSettings('project')).toMatchObject({
      preference: 'herdr',
      sessionName: 'team'
    })

    source.commitHerdrActivation('project', 'local')
    const persisted = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(persisted.projects.project.activations.local).toEqual({
      backend: 'herdr',
      state: 'ready'
    })
  })

  it('preserves Orca for an upgraded profile without a sidecar choice', () => {
    const settingsPath = makeSettingsPath()
    const source = createHorcaTerminalSettingsSource(makeStore(['folder'], 1), settingsPath)

    expect(source.getDefaultBackend()).toBe('orca')
    source.updateProject('folder', { preference: 'herdr' })
    expect(source.getDefaultBackend()).toBe('orca')
    expect(JSON.parse(readFileSync(settingsPath, 'utf8')).terminalBackendDefault).toBe('orca')
  })

  it('updates defaults and project settings in the Horca sidecar', () => {
    const settingsPath = makeSettingsPath()
    const source = createHorcaTerminalSettingsSource(makeStore(['folder']), settingsPath)
    const snapshots: unknown[] = []
    source.subscribe((snapshot) => snapshots.push(snapshot))

    source.updateDefaults({
      defaultBackend: 'orca',
      binarySource: { kind: 'custom', path: '/opt/bin/herdr' },
      defaultSessionName: 'shared',
      floatingPreference: 'inherit'
    })
    const snapshot = source.updateProject('folder', { preference: 'herdr' })

    expect(snapshot.defaults).toEqual({
      defaultBackend: 'orca',
      binarySource: { kind: 'custom', path: '/opt/bin/herdr' },
      defaultSessionName: 'shared',
      floatingPreference: 'inherit'
    })
    expect(snapshot.projects.folder.preference).toBe('herdr')
    expect(snapshots).toHaveLength(2)
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toMatchObject({
      version: 2,
      terminalBackendDefault: 'orca',
      herdr: {
        binarySource: { kind: 'custom', path: '/opt/bin/herdr' },
        defaultSessionName: 'shared'
      },
      projects: { folder: { preference: 'herdr' } }
    })
  })
})
