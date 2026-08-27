export type ReconnectionConfig = {
  enabled: boolean
  initialDelayMs: number
  maxDelayMs: number
  maxAttempts: number
  factor: number
}

export const DEFAULT_RECONNECTION_CONFIG = {
  enabled: true,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  maxAttempts: 10,
  factor: 2
} as const

export type ReconnectionState = {
  attempt: number
  nextDelayMs: number
  lastAttemptTime: number
  timer: NodeJS.Timeout | null
}

export class ReconnectionCancelledError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReconnectionCancelledError'
  }
}

export class HerdrSocketReconnection {
  private state: ReconnectionState = {
    attempt: 0,
    nextDelayMs: 0,
    lastAttemptTime: 0,
    timer: null
  }

  private config: ReconnectionConfig
  private connectFn: () => Promise<void>
  private onReconnecting?: (attempt: number, delayMs: number) => void
  private onReconnected?: () => void
  private onMaxAttemptsReached?: (error: Error) => void
  private cancelled = false
  private generation = 0
  private inFlight = false

  constructor(
    connectFn: () => Promise<void>,
    config?: Partial<ReconnectionConfig>,
    callbacks?: {
      onReconnecting?: (attempt: number, delayMs: number) => void
      onReconnected?: () => void
      onMaxAttemptsReached?: (error: Error) => void
    }
  ) {
    this.connectFn = connectFn
    this.config = { ...DEFAULT_RECONNECTION_CONFIG, ...config }
    this.onReconnecting = callbacks?.onReconnecting
    this.onReconnected = callbacks?.onReconnected
    this.onMaxAttemptsReached = callbacks?.onMaxAttemptsReached
  }

  async attemptReconnection(): Promise<void> {
    const generation = this.generation
    if (this.cancelled) {
      return
    }
    if (this.inFlight) {
      return
    }
    this.inFlight = true
    try {
      await this.runAttempt(generation)
    } finally {
      if (this.generation === generation) {
        this.inFlight = false
      }
    }
  }

  private async runAttempt(generation: number): Promise<void> {
    if (!this.config.enabled) {
      throw new ReconnectionCancelledError('Reconnection is disabled')
    }
    if (this.state.attempt >= this.config.maxAttempts) {
      const error = new Error(`Max reconnection attempts (${this.config.maxAttempts}) reached`)
      this.onMaxAttemptsReached?.(error)
      throw error
    }
    this.state.attempt++
    this.state.nextDelayMs = Math.min(
      this.config.initialDelayMs * this.config.factor ** (this.state.attempt - 1),
      this.config.maxDelayMs
    )
    this.onReconnecting?.(this.state.attempt, this.state.nextDelayMs)
    await this.sleep(this.state.nextDelayMs)
    if (this.cancelled || this.generation !== generation) {
      return
    }
    try {
      await this.connectFn()
      if (this.generation !== generation) {
        return
      }
      this.state.attempt = 0
      this.state.nextDelayMs = 0
      this.onReconnected?.()
    } catch {
      if (this.cancelled || this.generation !== generation) {
        return
      }
      await this.runAttempt(generation)
    }
  }

  private sleepResolve: (() => void) | null = null

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.state.timer) {
        clearTimeout(this.state.timer)
      }
      this.sleepResolve = resolve
      this.state.timer = setTimeout(() => {
        this.sleepResolve = null
        resolve()
      }, ms)
    })
  }

  cancel(): void {
    this.cancelled = true
    if (this.state.timer) {
      clearTimeout(this.state.timer)
      this.state.timer = null
    }
    const resolve = this.sleepResolve
    this.sleepResolve = null
    resolve?.()
  }

  reset(): void {
    this.generation += 1
    this.inFlight = false
    this.cancel()
    this.cancelled = false
    this.state = {
      attempt: 0,
      nextDelayMs: 0,
      lastAttemptTime: 0,
      timer: null
    }
  }

  isReconnecting(): boolean {
    return this.state.attempt > 0
  }

  getAttemptCount(): number {
    return this.state.attempt
  }

  getNextDelayMs(): number {
    return this.state.nextDelayMs
  }
}
