import { BrowserWindow, dialog, ipcMain } from 'electron'
import Store from 'electron-store'
import { IpcChannels } from '@shared/ipc'
import { DEFAULT_PREFS, type Prefs, type PrefsSetResult } from '@shared/prefs'

const store = new Store<Prefs>({ defaults: DEFAULT_PREFS })

export const SHORTCUT_FIELDS = ['captureShortcut', 'fullscreenShortcut', 'windowShortcut'] as const
export type ShortcutField = (typeof SHORTCUT_FIELDS)[number]

export function getPrefs(): Prefs {
  return { ...DEFAULT_PREFS, ...store.store }
}

/**
 * Wire prefs IPC. `onShortcutChange` must attempt (re)registration of the
 * given shortcut field and return false if the accelerator could not be
 * registered — the change is then rolled back and reported to the renderer.
 */
export function registerPrefsIpc(
  onShortcutChange: (field: ShortcutField, accelerator: string) => boolean,
  onSaved?: (prefs: Prefs) => void
): void {
  ipcMain.handle(IpcChannels.prefsGet, (): Prefs => getPrefs())

  ipcMain.handle(IpcChannels.prefsSet, (_event, patch: Partial<Prefs>): PrefsSetResult => {
    const current = getPrefs()

    for (const field of SHORTCUT_FIELDS) {
      const next = patch[field]
      if (next && next !== current[field]) {
        if (!onShortcutChange(field, next)) {
          // Roll back: put the old accelerator back in place.
          onShortcutChange(field, current[field])
          return {
            ok: false,
            error: `Could not register "${next}" — it may be in use by another app or by another Snapkit shortcut.`,
            prefs: current
          }
        }
      }
    }

    store.set({ ...current, ...patch })
    const updated = getPrefs()
    onSaved?.(updated)
    return { ok: true, prefs: updated }
  })

  ipcMain.handle(IpcChannels.prefsPickDir, async (event): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openDirectory' as const, 'createDirectory' as const] }
    const { canceled, filePaths } = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return canceled || filePaths.length === 0 ? null : filePaths[0]
  })
}
