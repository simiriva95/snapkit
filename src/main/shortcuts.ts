import { globalShortcut } from 'electron'
import { DEFAULT_CAPTURE_SHORTCUT } from '@shared/ipc'

/** Register global shortcuts. Call from app.whenReady(). */
export function registerShortcuts(onAreaCapture: () => void): void {
  const ok = globalShortcut.register(DEFAULT_CAPTURE_SHORTCUT, onAreaCapture)
  if (!ok) {
    // Another app owns the combo. Non-fatal: tray menu still works. M5 makes it configurable.
    console.warn(`[shortcuts] could not register ${DEFAULT_CAPTURE_SHORTCUT} (already in use?)`)
  }
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
