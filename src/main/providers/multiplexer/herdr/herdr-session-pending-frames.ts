import type { HerdrTerminalFrame } from './herdr-runtime-contract'

export const MAX_PENDING_HERDR_FRAMES = 512

export function pushPendingHerdrFrame(
  frames: HerdrTerminalFrame[],
  event: HerdrTerminalFrame
): void {
  frames.push(event)
  if (frames.length <= MAX_PENDING_HERDR_FRAMES) {
    return
  }
  let lastFull = -1
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    if (frames[index].full) {
      lastFull = index
      break
    }
  }
  if (lastFull >= 0) {
    if (lastFull > 0) {
      frames.splice(0, lastFull)
    }
    const extra = frames.length - MAX_PENDING_HERDR_FRAMES
    if (extra > 0) {
      frames.splice(1, extra)
    }
    return
  }
  frames.splice(0, frames.length - MAX_PENDING_HERDR_FRAMES)
}
