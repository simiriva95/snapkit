import { app, shell, BrowserWindow, ipcMain, session } from 'electron'
import { join } from 'path'
import { IpcChannels } from '@shared/ipc'
import { createTray, updateTrayShortcuts } from './tray'
import { initCapture, startCapture, type EditorHost } from './capture'
import { registerExportIpc } from './export'
import { getPrefs, registerPrefsIpc, type ShortcutField } from './prefs'
import { registerLicenseIpc } from './license'
import { APP_URL, registerAppScheme, serveRenderer } from './protocol'
import { registerRecorderIpc, setupDisplayMediaHandler } from './recorder'
import { registerShortcut, unregisterShortcuts } from './shortcuts'
import { initAutoUpdate } from './updater'
import { applyHistoryPrefs, initHistory, openHistoryPanel, stopHistory } from './history'
import { initOcrIndex, stopOcrIndex } from './ocrIndex'

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

  // Dev: Vite server. Prod: custom app:// scheme (see protocol.ts).
  void win.loadURL(RENDERER_DEV_URL ?? `${APP_URL}/index.html`)

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
          // wasm-unsafe-eval: required by the local Tesseract OCR core (WASM).
          "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:"
        ]
      }
    })
  })
}

function registerIpc(): void {
  ipcMain.handle(IpcChannels.appVersion, () => app.getVersion())
  ipcMain.on(IpcChannels.windowHide, () => mainWindow?.hide())
}

// Must happen before app is ready.
registerAppScheme()

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
    // Dev runs the stock Electron binary → give the Dock our icon anyway.
    // Packaged builds carry the real .icns and skip this.
    if (!app.isPackaged && process.platform === 'darwin') {
      app.dock?.setIcon(join(app.getAppPath(), 'build/icon.png'))
    }
    if (!RENDERER_DEV_URL) serveRenderer()
    applyProductionCsp()
    registerIpc()
    registerLicenseIpc()
    initAutoUpdate()
    mainWindow = createWindow()

    const host: EditorHost = {
      peek: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
      ensure: () => {
        if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow()
        return mainWindow
      }
    }
    initCapture(host)
    registerExportIpc()
    registerRecorderIpc(host)
    setupDisplayMediaHandler()
    initOcrIndex()
    initHistory()

    // All entry points route through startCapture — the license guard lives there.
    const handlers: Record<ShortcutField, () => void> = {
      captureShortcut: () => startCapture('area', host),
      fullscreenShortcut: () => startCapture('fullscreen', host),
      windowShortcut: () => startCapture('window', host),
      historyShortcut: () => openHistoryPanel()
    }
    const prefs = getPrefs()
    for (const field of Object.keys(handlers) as ShortcutField[]) {
      if (!registerShortcut(field, prefs[field], handlers[field])) {
        console.warn(`[shortcuts] could not register ${prefs[field]} (already in use?)`)
      }
    }
    registerPrefsIpc(
      (field, accelerator) => registerShortcut(field, accelerator),
      (updated) => {
        updateTrayShortcuts(updated)
        applyHistoryPrefs(updated.clipboardHistory)
      }
    )

    createTray(
      {
        show: () => {
          if (!mainWindow) mainWindow = createWindow()
          mainWindow.show()
          mainWindow.focus()
        },
        captureArea: handlers.captureShortcut,
        captureFullscreen: handlers.fullscreenShortcut,
        captureWindow: handlers.windowShortcut,
        captureScrolling: () => startCapture('scrolling', host),
        recordArea: () => startCapture('record', host),
        clipboardHistory: () => openHistoryPanel(),
        quit: () => {
          isQuitting = true
          app.quit()
        }
      },
      prefs
    )

    app.on('activate', () => {
      // macOS: re-show or recreate the window when the dock icon is clicked.
      if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow()
      mainWindow.show()
    })
  })

  // Do NOT quit on window-all-closed: this is a tray-resident app.
  app.on('window-all-closed', () => {})

  app.on('will-quit', () => {
    unregisterShortcuts()
    stopHistory()
    stopOcrIndex()
  })
}
