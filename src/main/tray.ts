import { Tray, Menu, nativeImage } from 'electron'
import type { Prefs } from '@shared/prefs'
// electron-vite copies this next to the bundle and rewrites the path (?asset).
import trayIconPath from '../../resources/tray-iconTemplate.png?asset'

export interface TrayActions {
  show: () => void
  captureArea: () => void
  captureFullscreen: () => void
  captureWindow: () => void
  captureScrolling: () => void
  recordArea: () => void
  recordScreen: () => void
  recordWindow: () => void
  editVideo: () => void
  clipboardHistory: () => void
  quit: () => void
}

type TrayShortcuts = Pick<
  Prefs,
  | 'captureShortcut'
  | 'fullscreenShortcut'
  | 'windowShortcut'
  | 'scrollingShortcut'
  | 'recordShortcut'
  | 'recordScreenShortcut'
  | 'recordWindowShortcut'
  | 'historyShortcut'
>

// Keep a module-level ref so the tray isn't garbage-collected.
let tray: Tray | null = null
let actionsRef: TrayActions | null = null

function buildMenu(shortcuts: TrayShortcuts): Menu {
  const actions = actionsRef
  if (!actions) throw new Error('tray menu built before createTray')
  return Menu.buildFromTemplate([
    // Accelerators are display hints only — real registration is in shortcuts.ts.
    { label: 'Capture Area', accelerator: shortcuts.captureShortcut, click: actions.captureArea },
    {
      label: 'Capture Full Screen',
      accelerator: shortcuts.fullscreenShortcut,
      click: actions.captureFullscreen
    },
    {
      label: 'Capture Window',
      accelerator: shortcuts.windowShortcut,
      click: actions.captureWindow
    },
    {
      label: 'Scrolling Capture',
      accelerator: shortcuts.scrollingShortcut,
      click: actions.captureScrolling
    },
    { type: 'separator' },
    { label: 'Record Area…', accelerator: shortcuts.recordShortcut, click: actions.recordArea },
    {
      label: 'Record Screen',
      accelerator: shortcuts.recordScreenShortcut,
      click: actions.recordScreen
    },
    {
      label: 'Record Window…',
      accelerator: shortcuts.recordWindowShortcut,
      click: actions.recordWindow
    },
    { label: 'Edit Video…', click: actions.editVideo },
    { type: 'separator' },
    {
      label: 'Clipboard History',
      accelerator: shortcuts.historyShortcut,
      click: actions.clipboardHistory
    },
    { type: 'separator' },
    { label: 'Open Snapkit', click: actions.show },
    { type: 'separator' },
    { label: 'Quit Snapkit', click: actions.quit }
  ])
}

export function createTray(actions: TrayActions, shortcuts: TrayShortcuts): Tray {
  actionsRef = actions
  const icon = nativeImage.createFromPath(trayIconPath)
  // macOS: a template image auto-adapts to light/dark menu bars.
  if (process.platform === 'darwin') icon.setTemplateImage(true)

  tray = new Tray(icon)
  tray.setToolTip('Snapkit')
  tray.setContextMenu(buildMenu(shortcuts))
  // Left-click (or click on non-macOS) opens the window.
  tray.on('click', actions.show)

  return tray
}

/** Reflect shortcut changes in the tray menu hints. */
export function updateTrayShortcuts(shortcuts: TrayShortcuts): void {
  tray?.setContextMenu(buildMenu(shortcuts))
}
