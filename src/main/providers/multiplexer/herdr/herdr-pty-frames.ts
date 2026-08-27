import { Buffer } from 'node:buffer'
import { TERMINAL_SCROLLBACK_REPLAY_BYTE_LIMIT } from '../../../../shared/terminal-scrollback-limits'
import type { HerdrTerminalController, HerdrTerminalFrame } from './herdr-runtime-contract'
import type { HerdrPtyBinding } from './herdr-pty-types'
import { openSharedHerdrPaneController } from './herdr-pty-attach'

function decodeFrame(frame: HerdrTerminalFrame): string {
  return Buffer.from(frame.bytes, 'base64').toString('utf8')
}

export async function waitForFirstHerdrFrame(
  binding: HerdrPtyBinding,
  callbacks: {
    emitData(payload: { id: string; data: string; sequenceChars: number }): void
    emitWriteUnavailable(payload: { id: string }): void
    detach(): void
  }
): Promise<{ frame: HerdrTerminalFrame; data: string } | null> {
  return await new Promise((resolve, reject) => {
    let first = true
    let observeGeneration = 0
    let observeReconnects = 0
    const timeout = setTimeout(() => {
      first = false
      resolve(null)
    }, 2_000)
    const onFrame = (frame: HerdrTerminalFrame): void => {
      const data = decodeFrame(frame)
      binding.cols = frame.width
      binding.rows = frame.height
      if (first) {
        first = false
        clearTimeout(timeout)
        binding.snapshot = data
        resolve({ frame, data })
        return
      }
      if (frame.full) {
        const previous = binding.snapshot
        binding.snapshot = data
        const appended = data.startsWith(previous)
        const delta = appended ? data.slice(previous.length) : data
        if (!delta) {
          return
        }
        const out = appended ? delta : `\x1b[0m\x1b[2J\x1b[H${data}`
        binding.sequenceChars += out.length
        callbacks.emitData({ id: binding.id, data: out, sequenceChars: binding.sequenceChars })
        return
      }
      binding.snapshot = `${binding.snapshot}${data}`
      if (binding.snapshot.length > TERMINAL_SCROLLBACK_REPLAY_BYTE_LIMIT) {
        binding.snapshot = binding.snapshot.slice(
          binding.snapshot.length - TERMINAL_SCROLLBACK_REPLAY_BYTE_LIMIT
        )
      }
      binding.sequenceChars += data.length
      callbacks.emitData({ id: binding.id, data, sequenceChars: binding.sequenceChars })
    }
    const subscribe = (controller: HerdrTerminalController): void => {
      const generation = ++observeGeneration
      binding.unsubscribe.push(
        controller.onFrame(onFrame),
        controller.onClosed((event) => {
          if (generation !== observeGeneration || binding.detached) {
            return
          }
          if (first) {
            first = false
            clearTimeout(timeout)
            callbacks.detach()
            reject(
              new Error(
                event.reason
                  ? `Herdr terminal controller closed before its first frame: ${event.reason}`
                  : 'Herdr terminal controller closed before its first frame'
              )
            )
            return
          }
          callbacks.emitWriteUnavailable({ id: binding.id })
          if (observeReconnects >= 3) {
            return
          }
          observeReconnects += 1
          try {
            const next = openSharedHerdrPaneController(
              binding.transport,
              binding.sessionName,
              binding.paneId,
              { cols: binding.cols, rows: binding.rows }
            )
            binding.controller = next
            subscribe(next)
          } catch {
            // Keep the binding. Stream loss is unverifiable, not pane death.
          }
        })
      )
    }
    subscribe(binding.controller)
  })
}

export function awaitFirstFrame(
  binding: HerdrPtyBinding,
  emitData: (payload: { id: string; data: string; sequenceChars: number }) => void,
  _emitExit: (payload: { id: string; code: number }) => void,
  emitWriteUnavailable: (payload: { id: string }) => void,
  detach: () => void
): Promise<{ frame: HerdrTerminalFrame; data: string } | null> {
  return waitForFirstHerdrFrame(binding, { emitData, emitWriteUnavailable, detach })
}
