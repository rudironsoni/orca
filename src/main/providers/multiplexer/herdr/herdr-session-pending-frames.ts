import type { HerdrTerminalFrame } from './herdr-runtime-contract'

export const MAX_PENDING_HERDR_FRAMES = 512

export function pushPendingHerdrFrame(
  frames: HerdrTerminalFrame[],
  event: HerdrTerminalFrame
): void {
  if (!event.full && frames.length > 0) {
    const last = frames.at(-1)
    if (!last || last.seq + 1 !== event.seq) {
      return
    }
  }
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
    if (frames.length > MAX_PENDING_HERDR_FRAMES) {
      frames.length = MAX_PENDING_HERDR_FRAMES
    }
    return
  }
  frames.splice(0, frames.length - MAX_PENDING_HERDR_FRAMES)
}
