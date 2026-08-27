import { afterEach, describe, expect, it } from 'vitest'
import {
  downstreamMinimizeToTrayNotice,
  downstreamUpdatesDisabledCopy
} from './distribution-update-copy'

describe('downstreamUpdatesDisabledCopy', () => {
  afterEach(() => {
    delete (globalThis as { ORCA_DISTRIBUTION?: string }).ORCA_DISTRIBUTION
  })

  it('names the active distribution in the Windows tray minimize notice', () => {
    ;(globalThis as { ORCA_DISTRIBUTION?: string }).ORCA_DISTRIBUTION = 'horca'
    const notice = downstreamMinimizeToTrayNotice()
    expect(notice.title).toBe('Horca')
    expect(notice.body).toContain('Horca')
  })

  it('names the active distribution in every copy kind', () => {
    ;(globalThis as { ORCA_DISTRIBUTION?: string }).ORCA_DISTRIBUTION = 'horca'
    expect(downstreamUpdatesDisabledCopy('card')).toContain('Horca')
    expect(downstreamUpdatesDisabledCopy('settings')).toContain('Horca')
    expect(downstreamUpdatesDisabledCopy('aria')).toContain('Horca')
  })
})
