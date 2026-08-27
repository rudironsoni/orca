import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Store } from '../../persistence'
import {
  createHorcaTerminalSettingsSource,
  horcaTerminalSettingsPath
} from './horca-terminal-settings'

const temporaryDirectories: string[] = []

function makeSettingsPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'horca-settings-'))
  temporaryDirectories.push(directory)
  return horcaTerminalSettingsPath(join(directory, 'profile.json'))
}

function makeStore(): Store {
  return {
    getSettings: () => ({}),
    getProjects: () => []
  } as unknown as Store
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Horca terminal settings', () => {
  it('defaults Horca profiles to Herdr without changing Orca settings', () => {
    const source = createHorcaTerminalSettingsSource(makeStore(), makeSettingsPath())

    expect(source.getDefaultBackend()).toBe('herdr')
    expect(source.getHerdrSettings('local')).toEqual({
      binarySource: { kind: 'system' },
      defaultSessionName: undefined
    })
  })

  it('reads explicit sidecar settings and persists host activation', () => {
    const settingsPath = makeSettingsPath()
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
})
