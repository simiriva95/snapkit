import { Tray, Menu, nativeImage } from 'electron'
// electron-vite copies this next to the bundle and rewrites the path (?asset).
import trayIconPath from '../../resources/tray-iconTemplate.png?asset'

export interface TrayActions {
  show: () => void
  captureArea: () => void
  quit: () => void
}

// Keep a module-level ref so the tray isn't garbage-collected.
let tray: Tray | null = null
let actionsRef: TrayActions | null = null

function buildMenu(accelerator: string): Menu {
  const actions = actionsRef
  if (!actions) throw new Error('tray menu built before createTray')
  return Menu.buildFromTemplate([
    {
      label: 'Capture Area',
      // Display hint only — the real registration is in shortcuts.ts.
      accelerator,
      click: actions.captureArea
    },
    { type: 'separator' },
    { label: 'Open Snapkit', click: actions.show },
    { type: 'separator' },
    { label: 'Quit Snapkit', click: actions.quit }
  ])
}

export function createTray(actions: TrayActions, accelerator: string): Tray {
  actionsRef = actions
  const icon = nativeImage.createFromPath(trayIconPath)
  // macOS: a template image auto-adapts to light/dark menu bars.
  if (process.platform === 'darwin') icon.setTemplateImage(true)

  tray = new Tray(icon)
  tray.setToolTip('Snapkit')
  tray.setContextMenu(buildMenu(accelerator))
  // Left-click (or click on non-macOS) opens the window.
  tray.on('click', actions.show)

  return tray
}

/** Reflect a shortcut change in the tray menu hint. */
export function updateTrayShortcut(accelerator: string): void {
  tray?.setContextMenu(buildMenu(accelerator))
}
