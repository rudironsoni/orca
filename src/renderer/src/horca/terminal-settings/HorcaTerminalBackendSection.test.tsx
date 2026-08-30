// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HorcaTerminalBackendSection } from './HorcaTerminalBackendSection'
import { HorcaProjectTerminalBackendSetting } from './HorcaProjectTerminalBackendSetting'

const terminalSettings = vi.hoisted(() => ({
  snapshot: {
    defaults: {
      defaultBackend: 'herdr' as const,
      binarySource: { kind: 'system' as const },
      defaultSessionName: 'horca',
      floatingPreference: 'inherit' as const
    },
    projects: {
      project: {
        preference: 'inherit' as const,
        activations: {}
      }
    }
  },
  updateDefaults: vi.fn(),
  updateProject: vi.fn()
}))

vi.mock('./use-horca-terminal-settings', () => ({
  useHorcaTerminalSettings: () => terminalSettings
}))

function optionLabels(groupName: string): string[] {
  return within(screen.getByRole('radiogroup', { name: groupName }))
    .getAllByRole('radio')
    .map((option) => option.textContent ?? '')
}

describe('Horca terminal backend settings', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        horcaTerminalSettings: {
          getHerdrHealth: vi.fn(async () => ({
            status: 'ready',
            source: { kind: 'system' },
            executable: 'herdr',
            version: '0.8.2'
          }))
        }
      }
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('puts the Herdr and PATH defaults first and shows the shared Horca session', () => {
    render(<HorcaTerminalBackendSection />)

    expect(optionLabels('Default terminal backend')).toEqual(['Herdr', 'Orca'])
    expect(optionLabels('Floating terminal backend')).toEqual(['Inherit', 'Herdr', 'Orca'])
    expect(optionLabels('Herdr executable source')).toEqual(['From PATH', 'Bundled', 'Custom'])
    expect((screen.getByLabelText('Shared Herdr session name') as HTMLInputElement).value).toBe(
      'horca'
    )
    expect(screen.getByText('Clear this value to use the Horca session.')).toBeDefined()
  })

  it('orders the project backend override after Inherit', () => {
    render(
      <HorcaProjectTerminalBackendSetting
        projectId="project"
        projectName="Project"
        searchQuery=""
      />
    )

    expect(optionLabels('Project terminal backend')).toEqual(['Inherit', 'Herdr', 'Orca'])
  })
})
