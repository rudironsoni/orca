import { describe, expect, it } from 'vitest'
import { herdrSessionNameForProject, herdrSplitDirection } from './herdr-session-identity'

describe('Herdr session identity', () => {
  it('uses the persisted project session name when linked explicitly', () => {
    expect(
      herdrSessionNameForProject({ id: 'Project 1', herdrSessionName: ' shared-session ' })
    ).toBe('shared-session')
  })

  it('uses the shared Horca default when no per-project override is set', () => {
    expect(herdrSessionNameForProject({ id: 'Project 1' }, 'horca')).toBe('horca')
    expect(herdrSessionNameForProject({ id: 'Project 1' }, ' shared-session ')).toBe(
      'shared-session'
    )
  })

  it('prefers the per-project override over the shared default', () => {
    expect(
      herdrSessionNameForProject({ id: 'Project 1', herdrSessionName: 'custom' }, 'horca')
    ).toBe('custom')
  })

  it('uses the Horca session when no name is configured', () => {
    expect(herdrSessionNameForProject({ id: 'Project 1' })).toBe('horca')
  })

  it('uses the Horca session when the shared value is blank', () => {
    expect(herdrSessionNameForProject({ id: 'Project 1' }, '   ')).toBe('horca')
  })

  it('translates Orca split axes exactly', () => {
    expect(herdrSplitDirection('vertical')).toBe('right')
    expect(herdrSplitDirection('horizontal')).toBe('down')
  })
})
