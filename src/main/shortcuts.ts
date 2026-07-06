import { globalShortcut } from 'electron'

interface Entry {
  accelerator: string
  handler: () => void
}

const entries = new Map<string, Entry>()

/**
 * (Re)register a named global shortcut. Unregisters that name's previous
 * accelerator first. Returns false if the accelerator is invalid or taken —
 * the caller decides how to roll back.
 */
export function registerShortcut(name: string, accelerator: string, handler?: () => void): boolean {
  const prev = entries.get(name)
  const fn = handler ?? prev?.handler
  if (!fn) return false

  if (prev) {
    globalShortcut.unregister(prev.accelerator)
    entries.delete(name)
  }

  try {
    const ok = globalShortcut.register(accelerator, fn)
    if (ok) entries.set(name, { accelerator, handler: fn })
    return ok
  } catch {
    // Malformed accelerator string throws.
    return false
  }
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
  entries.clear()
}
