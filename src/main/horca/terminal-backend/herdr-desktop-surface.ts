export type HerdrDesktopWindowHandle = {
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

export type HerdrDesktopSurface = {
  getFocusedWindow(): HerdrDesktopWindowHandle | null
  getAllWindows(): HerdrDesktopWindowHandle[]
}

const inertSurface: HerdrDesktopSurface = {
  getFocusedWindow: () => null,
  getAllWindows: () => []
}

let currentSurface: HerdrDesktopSurface = inertSurface

export function setHerdrDesktopSurface(surface: HerdrDesktopSurface | null): void {
  currentSurface = surface ?? inertSurface
}

export function getHerdrDesktopSurface(): HerdrDesktopSurface {
  return currentSurface
}
