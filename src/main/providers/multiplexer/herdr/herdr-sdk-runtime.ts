import {
  HerdrSdk,
  herdrSdkLayerFromOptions,
  type EventSubscriptionSpecEncoded,
  type HerdrEvent,
  type IHerdrSdk
} from '@herdr/sdk'
import { Duration, Effect, Fiber, Layer, Stream } from 'effect'
import { toHerdrRuntimeError } from './herdr-sdk-errors'
import { HerdrRuntimeError } from './herdr-runtime-contract'

export type HerdrSdkSessionTarget = {
  sessionName: string
  socketPath?: string
}

export type HerdrSdkRuntimeOptions = {
  application: { name: string; version: string }
  requestTimeout?: Duration.Duration
  resolveTarget: (sessionName: string) => HerdrSdkSessionTarget
}

type CachedSession = {
  key: string
  layer: Layer.Layer<HerdrSdk, never>
  fibers: Fiber.Fiber<void, unknown>[]
}

export class HerdrSdkRuntime {
  private readonly sessions = new Map<string, CachedSession>()

  constructor(private readonly options: HerdrSdkRuntimeOptions) {}

  layerFor(sessionName: string): Layer.Layer<HerdrSdk, never> {
    return this.cached(sessionName).layer
  }

  async run<A>(
    sessionName: string,
    operation: (herdr: IHerdrSdk) => Effect.Effect<A, unknown, HerdrSdk>
  ): Promise<A> {
    const program = Effect.gen(function* () {
      const herdr = yield* HerdrSdk
      return yield* operation(herdr)
    }).pipe(Effect.provide(this.layerFor(sessionName)))
    try {
      return await Effect.runPromise(program)
    } catch (error) {
      throw toHerdrRuntimeError(error)
    }
  }

  subscribe(
    sessionName: string,
    specs: readonly EventSubscriptionSpecEncoded[],
    listener: (event: HerdrEvent) => void
  ): () => void {
    const cached = this.cached(sessionName)
    const program = Effect.gen(function* () {
      const herdr = yield* HerdrSdk
      yield* herdr.events
        .subscribe(specs)
        .pipe(Stream.runForEach((event) => Effect.sync(() => listener(event))))
    }).pipe(Effect.provide(cached.layer))
    const fiber = Effect.runFork(program)
    cached.fibers.push(fiber)
    return () => {
      cached.fibers = cached.fibers.filter((item) => item !== fiber)
      void Effect.runPromise(Fiber.interrupt(fiber)).catch(() => undefined)
    }
  }

  async ping(sessionName: string): Promise<void> {
    await this.run(sessionName, (herdr) => herdr.server.ping())
  }

  async dispose(): Promise<void> {
    const fibers = [...this.sessions.values()].flatMap((session) => session.fibers)
    this.sessions.clear()
    await Promise.all(
      fibers.map((fiber) => Effect.runPromise(Fiber.interrupt(fiber)).catch(() => undefined))
    )
  }

  private cached(sessionName: string): CachedSession {
    const target = this.options.resolveTarget(sessionName)
    const key = target.socketPath ?? `session:${target.sessionName}`
    const existing = this.sessions.get(sessionName)
    if (existing && existing.key === key) {
      return existing
    }
    if (existing) {
      void this.disposeSession(existing)
    }
    const layer = this.createLayer(target).pipe(Layer.orDie, Layer.fresh) as Layer.Layer<
      HerdrSdk,
      never
    >
    const created: CachedSession = { key, layer, fibers: [] }
    this.sessions.set(sessionName, created)
    return created
  }

  private createLayer(target: HerdrSdkSessionTarget): Layer.Layer<HerdrSdk, unknown> {
    const timeout = this.options.requestTimeout ?? Duration.seconds(15)
    if (target.socketPath) {
      return herdrSdkLayerFromOptions({
        socketPath: target.socketPath,
        requestTimeout: timeout,
        application: this.options.application
      })
    }
    if (!target.sessionName.trim()) {
      throw new HerdrRuntimeError('herdr_invalid_input', 'Herdr session name is empty')
    }
    return herdrSdkLayerFromOptions({
      session: target.sessionName,
      requestTimeout: timeout,
      application: this.options.application
    })
  }

  private async disposeSession(session: CachedSession): Promise<void> {
    await Promise.all(
      session.fibers.map((fiber) =>
        Effect.runPromise(Fiber.interrupt(fiber)).catch(() => undefined)
      )
    )
  }
}
