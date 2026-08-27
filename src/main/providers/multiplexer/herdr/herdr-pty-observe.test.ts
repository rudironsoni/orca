import { describe, expect, it, vi } from 'vitest'
import { decodeHerdrPtyId, HerdrPtyProvider } from './herdr-pty-provider'
import { encodeHerdrPtyId } from './herdr-pty-types'
import { target, transport } from './herdr-pty-provider-test-transport'

describe('Herdr observe and attachOnly', () => {
  it('attaches attachOnly to a reminted pane id from reconcile', async () => {
    const host = transport()
    const provider = new HerdrPtyProvider(
      () => host.value,
      async () => target(),
      () => 'test-session'
    )
    const staleSessionId = encodeHerdrPtyId({
      version: 2,
      hostId: 'local',
      projectId: 'project-1',
      worktreeId: 'repo-1::/repo',
      tabId: 'tab-1',
      leafId: 'leaf-1',
      paneId: 'p-stale'
    })
    const spawned = await provider.spawn({
      cols: 80,
      rows: 24,
      cwd: '/repo',
      sessionId: staleSessionId,
      attachOnly: true,
      worktreeId: 'repo-1::/repo',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1'
    })
    expect(decodeHerdrPtyId(spawned.id)?.paneId).toBe('p1')
  })

  it('signals attachOnly as gone when reconcile has no pane for the leaf', async () => {
    const host = transport()
    const missing = target()
    missing.identity.leafId = 'leaf-missing'
    const provider = new HerdrPtyProvider(
      () => host.value,
      async () => missing,
      () => 'test-session'
    )
    const sessionId = encodeHerdrPtyId({
      version: 2,
      hostId: 'local',
      projectId: 'project-1',
      worktreeId: 'repo-1::/repo',
      tabId: 'tab-1',
      leafId: 'leaf-missing',
      paneId: 'p-stale'
    })
    await expect(
      provider.spawn({
        cols: 80,
        rows: 24,
        cwd: '/repo',
        sessionId,
        attachOnly: true,
        worktreeId: 'repo-1::/repo',
        tabId: 'tab-1',
        paneKey: 'tab-1:leaf-missing'
      })
    ).rejects.toThrow(/Session not found/)
  })

  it('does not emit exit when the observe stream closes after the first frame', async () => {
    const host = transport()
    const provider = new HerdrPtyProvider(
      () => host.value,
      async () => target(),
      () => 'test-session'
    )
    const exits: string[] = []
    const unavailable: string[] = []
    provider.onExit((payload) => exits.push(payload.id))
    provider.onWriteUnavailable((payload) => unavailable.push(payload.id))
    const spawned = await provider.spawn({
      cols: 80,
      rows: 24,
      cwd: '/repo',
      worktreeId: 'repo-1::/repo',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1'
    })
    host.closeObserve('drop')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(exits).toEqual([])
    expect(unavailable).toEqual([spawned.id])
    const observeCalls = vi
      .mocked(host.value.controlTerminal!)
      .mock.calls.filter((call) => call[2]?.observe === true)
    expect(observeCalls.length).toBeGreaterThanOrEqual(2)
  })
})
