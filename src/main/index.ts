import { app, shell, BrowserWindow, ipcMain, session } from 'electron'
import { join } from 'path'
import { IpcChannels } from '@shared/ipc'
import { createTray } from './tray'

// electron-vite injects this in dev; absent in a packaged build.
const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']

let mainWindow: BrowserWindow | null = null
// Tray apps hide on close instead of quitting; this flag lets "Quit" really quit.
let isQuitting = false

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    // Frameless for a clean, chrome-less look. macOS keeps the traffic lights.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 12, y: 14 } }
      : { frame: false }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // Keep the app alive in the tray when the window is closed.
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      win.hide()
    }
  })

  // Open external links in the user's browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (RENDERER_DEV_URL) {
    void win.loadURL(RENDERER_DEV_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// Restrictive CSP in production. In dev we rely on the local Vite server, whose
// HMR needs inline scripts and a websocket, so we skip it there.
function applyProductionCsp(): void {
  if (!app.isPackaged) return
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'"
        ]
      }
    })
  })
}

function registerIpc(): void {
  ipcMain.handle(IpcChannels.appVersion, () => app.getVersion())
  ipcMain.on(IpcChannels.windowHide, () => mainWindow?.hide())
}

// Single-instance: focus the existing window instead of spawning a second app.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    applyProductionCsp()
    registerIpc()
    mainWindow = createWindow()
    createTray({
      show: () => {
        if (!mainWindow) mainWindow = createWindow()
        mainWindow.show()
        mainWindow.focus()
      },
      quit: () => {
        isQuitting = true
        app.quit()
      }
    })

    app.on('activate', () => {
      // macOS: re-show or recreate the window when the dock icon is clicked.
      if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow()
      mainWindow.show()
    })
  })

  // Do NOT quit on window-all-closed: this is a tray-resident app.
  app.on('window-all-closed', () => {})
}
