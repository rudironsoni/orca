import { BrowserWindow } from 'electron'
import type { HerdrDesktopSurface, HerdrDesktopWindowHandle } from './herdr-desktop-surface'

function toWindowHandle(window: BrowserWindow): HerdrDesktopWindowHandle {
  return {
    isDestroyed: () => window.isDestroyed(),
    send: (channel, payload) => {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, payload)
      }
    }
  }
}

export const electronHerdrDesktopSurface: HerdrDesktopSurface = {
  getFocusedWindow: () => {
    const focused = BrowserWindow.getFocusedWindow()
    return focused ? toWindowHandle(focused) : null
  },
  getAllWindows: () => BrowserWindow.getAllWindows().map(toWindowHandle)
}
