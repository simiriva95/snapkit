import { Tray, Menu, nativeImage } from 'electron'
import { DEFAULT_CAPTURE_SHORTCUT } from '@shared/ipc'
// electron-vite copies this next to the bundle and rewrites the path (?asset).
import trayIconPath from '../../resources/tray-iconTemplate.png?asset'

export interface TrayActions {
  show: () => void
  captureArea: () => void
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
      {
        label: 'Capture Area',
        // Display hint only — the real registration is in shortcuts.ts.
        accelerator: DEFAULT_CAPTURE_SHORTCUT,
        click: actions.captureArea
      },
      { type: 'separator' },
      { label: 'Open Snapkit', click: actions.show },
      { type: 'separator' },
      { label: 'Quit Snapkit', click: actions.quit }
    ])
  )
  // Left-click (or click on non-macOS) opens the window.
  tray.on('click', actions.show)

  return tray
}
