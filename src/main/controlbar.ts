import { BrowserWindow, screen, type Rectangle } from 'electron'
import { join } from 'path'
import { IpcChannels, type ControlMode } from '@shared/ipc'
import { APP_URL } from './protocol'

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']

const WIDTH = 280
const HEIGHT = 48

/**
 * Small always-on-top bar shown under the captured region while a scrolling
 * capture or recording session runs (Done/Stop + Cancel + live status).
 */
export function createControlBar(mode: ControlMode, region: Rectangle): BrowserWindow {
  const display = screen.getDisplayMatching(region)
  const x = Math.round(
    Math.min(
      Math.max(region.x + region.width / 2 - WIDTH / 2, display.bounds.x + 8),
      display.bounds.x + display.bounds.width - WIDTH - 8
    )
  )
  // Below the region; above it if there is no room.
  const below = region.y + region.height + 12
  const y =
    below + HEIGHT + 8 <= display.bounds.y + display.bounds.height
      ? below
      : Math.max(region.y - HEIGHT - 12, display.bounds.y + 8)

  const win = new BrowserWindow({
    x,
    y,
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    show: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')

  win.webContents.once('did-finish-load', () => {
    win.webContents.send(IpcChannels.controlInit, { mode })
    win.showInactive() // never steal focus from the content being scrolled
  })

  void win.loadURL(
    RENDERER_DEV_URL ? `${RENDERER_DEV_URL}/controlbar.html` : `${APP_URL}/controlbar.html`
  )

  return win
}

export function sendControlStatus(win: BrowserWindow, text: string): void {
  if (!win.isDestroyed()) win.webContents.send(IpcChannels.controlStatus, { text })
}
