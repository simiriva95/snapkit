import { BrowserWindow, type Display } from 'electron'
import { join } from 'path'
import { IpcChannels } from '@shared/ipc'

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']

/**
 * Fullscreen, frameless selection overlay covering one display.
 * Shows a frozen screenshot (sent right after load) so the selection is
 * WYSIWYG even if the screen changes underneath.
 */
export function createOverlay(display: Display, previewDataUrl: string): BrowserWindow {
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    show: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: false,
    enableLargerThanScreen: true,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Above everything, including fullscreen apps and all workspaces.
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  win.webContents.once('did-finish-load', () => {
    win.webContents.send(IpcChannels.overlayInit, { dataUrl: previewDataUrl })
    win.show()
    win.focus()
  })

  if (RENDERER_DEV_URL) {
    void win.loadURL(`${RENDERER_DEV_URL}/overlay.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/overlay.html'))
  }

  return win
}
