import { Tray, Menu, nativeImage } from 'electron'
// electron-vite copies this next to the bundle and rewrites the path (?asset).
import trayIconPath from '../../resources/tray-iconTemplate.png?asset'

export interface TrayActions {
  show: () => void
  quit: () => void
}

// Keep a module-level ref so the tray isn't garbage-collected.
let tray: Tray | null = null

export function createTray(actions: TrayActions): Tray {
  const icon = nativeImage.createFromPath(trayIconPath)
  // macOS: a template image auto-adapts to light/dark menu bars.
  if (process.platform === 'darwin') icon.setTemplateImage(true)

  tray = new Tray(icon)
  tray.setToolTip('Snapkit')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Snapkit', click: actions.show },
      { type: 'separator' },
      { label: 'Quit Snapkit', click: actions.quit }
    ])
  )
  // Left-click (or click on non-macOS) opens the window.
  tray.on('click', actions.show)

  return tray
}
