import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { IpcChannels, type OcrJob } from '@shared/ipc'
import { APP_URL } from './protocol'

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']

/** Give up on a single OCR job after this long so pending never leaks. */
const OCR_TIMEOUT_MS = 60_000

let win: BrowserWindow | null = null
const pending = new Map<string, (text: string) => void>()
let seq = 0

function ensureWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win
  win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // OCR runs in the background; don't let Chromium park the timers/WASM.
      backgroundThrottling: false
    }
  })
  win.on('closed', () => {
    win = null
  })
  void win.loadURL(RENDERER_DEV_URL ? `${RENDERER_DEV_URL}/ocr.html` : `${APP_URL}/ocr.html`)
  return win
}

/** Wire the result channel. Call once at startup. */
export function initOcrIndex(): void {
  ipcMain.on(IpcChannels.ocrResult, (_e, id: string, text: string) => {
    const resolve = pending.get(id)
    if (!resolve) return
    pending.delete(id)
    resolve(text)
  })
}

/** OCR an image data URL to plain text. Resolves '' on failure/timeout. */
export function ocrImage(dataUrl: string, langs: string[]): Promise<string> {
  return new Promise((resolve) => {
    const id = String(seq++)
    let done = false
    const finish = (text: string): void => {
      if (done) return
      done = true
      pending.delete(id)
      resolve(text)
    }
    pending.set(id, finish)
    setTimeout(() => finish(''), OCR_TIMEOUT_MS)

    const w = ensureWindow()
    const job: OcrJob = { id, dataUrl, langs }
    if (w.webContents.isLoading()) {
      w.webContents.once('did-finish-load', () => w.webContents.send(IpcChannels.ocrRun, job))
    } else {
      w.webContents.send(IpcChannels.ocrRun, job)
    }
  })
}

export function stopOcrIndex(): void {
  if (win && !win.isDestroyed()) win.destroy()
  win = null
  pending.clear()
}
