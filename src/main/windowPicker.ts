import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { IpcChannels, type WindowSource } from '@shared/ipc'
import { APP_URL } from './protocol'

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']

/** Small centered chooser listing capturable windows. */
export function createWindowPicker(sources: WindowSource[]): BrowserWindow {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = 640
  const height = 480
  const win = new BrowserWindow({
    x: display.bounds.x + Math.round((display.bounds.width - width) / 2),
    y: display.bounds.y + Math.round((display.bounds.height - height) / 2),
    width,
    height,
    frame: false,
    show: false,
    resizable: false,
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

  win.webContents.once('did-finish-load', () => {
    win.webContents.send(IpcChannels.pickerInit, { sources })
    win.show()
    win.focus()
  })

  void win.loadURL(RENDERER_DEV_URL ? `${RENDERER_DEV_URL}/picker.html` : `${APP_URL}/picker.html`)

  return win
}
