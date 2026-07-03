import { globalShortcut } from 'electron'

let currentAccelerator: string | null = null
let currentHandler: (() => void) | null = null

/**
 * (Re)register the global capture shortcut. Unregisters the previous one.
 * Returns false if the accelerator is invalid or taken by another app —
 * the caller decides how to roll back.
 */
export function registerCaptureShortcut(accelerator: string, handler?: () => void): boolean {
  if (handler) currentHandler = handler
  if (!currentHandler) return false

  if (currentAccelerator) {
    globalShortcut.unregister(currentAccelerator)
    currentAccelerator = null
  }

  try {
    const ok = globalShortcut.register(accelerator, currentHandler)
    if (ok) currentAccelerator = accelerator
    return ok
  } catch {
    // Malformed accelerator string throws.
    return false
  }
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
  currentAccelerator = null
}
