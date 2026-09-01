import { posix } from 'node:path'
import { spawnProcess } from '../../../../shared/child-process/run-process'
import { getAppEnvironment } from '../../../../shared/app-environment'
import { getWslGuestEnvironment } from '../../../wsl/wsl-guest-environment'
import {
  HerdrRuntimeError,
  type HerdrHostTransport,
  type HerdrTerminalControlOptions,
  type HerdrTerminalController
} from './herdr-runtime-contract'
import { HerdrSdkRuntime } from './herdr-sdk-runtime'
import {
  HerdrCliSessionManager,
  herdrHostProcessSpec,
  type HerdrCommandFactory,
  type HerdrCommand
} from './herdr-cli-session'
import {
  createHerdrSessionControlController,
  createHerdrSessionControlFromOpen,
  herdrSessionControlArgs,
  herdrSessionControlStreamFromProcess
} from './herdr-session-control'
import { herdrSessionSocketPath } from './herdr-session-socket-path'
import { HerdrWslSocketRelay } from './herdr-wsl-socket-relay'

export type HerdrSdkHostOptions = {
  sdk?: HerdrSdkRuntime
  commandFor: HerdrCommandFactory
  serverCommandFor?: (sessionName: string) => HerdrCommand | Promise<HerdrCommand>
  timeoutMs?: number
  wslDistro?: string
  onDisconnect?: () => void
}

export class HerdrSdkHost implements HerdrHostTransport {
  readonly sdk: HerdrSdkRuntime
  readonly options: HerdrSdkHostOptions
  private readonly sessionManager: HerdrCliSessionManager
  private readonly relays = new Map<string, HerdrWslSocketRelay>()

  constructor(options: HerdrSdkHostOptions) {
    this.options = options
    this.sdk =
      options.sdk ??
      new HerdrSdkRuntime({
        application: { name: 'horca', version: getAppEnvironment().getVersion() },
        resolveTarget: (sessionName) => {
          const relay = this.relays.get(sessionName)
          if (relay) {
            return { sessionName, socketPath: relay.localSocketPath }
          }
          if (this.options.wslDistro) {
            throw new Error(`Herdr WSL relay is not listening for session ${sessionName}`)
          }
          return { sessionName }
        }
      })
    this.sessionManager = new HerdrCliSessionManager({
      commandFor: options.commandFor,
      serverCommandFor: options.serverCommandFor,
      timeoutMs: options.timeoutMs,
      wslDistro: options.wslDistro
    })
  }

  async ensureSession(sessionName: string): Promise<void> {
    await this.sessionManager.ensureSession(sessionName)
    if (this.options.wslDistro) {
      await this.ensureWslRelay(sessionName)
    }
    await this.sdk.ping(sessionName)
  }

  private async ensureWslRelay(sessionName: string): Promise<void> {
    if (this.relays.has(sessionName)) {
      return
    }
    const distro = this.options.wslDistro
    if (!distro) {
      return
    }
    const guest = await getWslGuestEnvironment(distro)
    if (!guest) {
      throw new HerdrRuntimeError(
        'herdr_unavailable',
        `WSL login environment is unverifiable for distro ${distro}`
      )
    }
    const relay = new HerdrWslSocketRelay(
      distro,
      sessionName,
      herdrSessionSocketPath(posix.join(guest.home, '.config'), sessionName)
    )
    this.relays.set(sessionName, relay)
    try {
      await relay.listen()
    } catch (error) {
      this.relays.delete(sessionName)
      await relay.dispose()
      throw error
    }
  }

  controlTerminal(
    sessionName: string,
    target: string,
    options: HerdrTerminalControlOptions
  ): HerdrTerminalController {
    const command = this.options.commandFor(herdrSessionControlArgs(sessionName, target, options))
    if (command instanceof Promise || this.options.wslDistro) {
      return createHerdrSessionControlFromOpen(async () => {
        const resolved = await command
        const child = spawnProcess(herdrHostProcessSpec(resolved, this.options.wslDistro))
        return herdrSessionControlStreamFromProcess(child)
      })
    }
    return createHerdrSessionControlController(command)
  }

  async disconnect(): Promise<void> {
    await this.sdk.dispose()
    await Promise.all([...this.relays.values()].map((relay) => relay.dispose()))
    this.relays.clear()
    this.options.onDisconnect?.()
  }
}
