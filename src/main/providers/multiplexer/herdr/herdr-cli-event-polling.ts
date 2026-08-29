import type { HerdrResponse, HerdrTransportEvent } from './herdr-runtime-contract'

const POLL_INTERVAL_MS = 500
const POLL_ERROR_BACKOFF_MS = 1_500

export class HerdrCliEventPoller {
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly fingerprints = new Map<string, string>()
  private disconnected = false

  constructor(
    private readonly requestSnapshot: (sessionName: string) => Promise<HerdrResponse<unknown>>,
    private readonly emit: (event: HerdrTransportEvent) => void
  ) {}

  start(sessionName: string): void {
    if (this.disconnected || this.timers.has(sessionName)) {
      return
    }
    const timer = setTimeout(() => void this.poll(sessionName), 0)
    timer.unref()
    this.timers.set(sessionName, timer)
  }

  disconnect(): void {
    this.disconnected = true
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
  }

  private async poll(sessionName: string): Promise<void> {
    this.timers.delete(sessionName)
    if (this.disconnected) {
      return
    }
    let delayMs = POLL_INTERVAL_MS
    try {
      const response = await this.requestSnapshot(sessionName)
      const fingerprint = JSON.stringify('result' in response ? response.result : response.error)
      const previous = this.fingerprints.get(sessionName)
      this.fingerprints.set(sessionName, fingerprint)
      if (previous && previous !== fingerprint) {
        this.emit({
          event: 'session.snapshot_changed',
          data: { type: 'session.snapshot_changed' },
          sessionName
        })
      }
    } catch {
      delayMs = POLL_ERROR_BACKOFF_MS
    }
    if (!this.disconnected) {
      const timer = setTimeout(() => void this.poll(sessionName), delayMs)
      timer.unref()
      this.timers.set(sessionName, timer)
    }
  }
}
