import { BrowserWindow, dialog, ipcMain } from 'electron'
import Store from 'electron-store'
import { IpcChannels } from '@shared/ipc'
import { DEFAULT_PREFS, type Prefs, type PrefsSetResult } from '@shared/prefs'

const store = new Store<Prefs>({ defaults: DEFAULT_PREFS })

export function getPrefs(): Prefs {
  return { ...DEFAULT_PREFS, ...store.store }
}

/**
 * Wire prefs IPC. `onShortcutChange` must attempt (re)registration and
 * return false if the accelerator could not be registered — the change is
 * then rolled back and reported to the renderer.
 */
export function registerPrefsIpc(onShortcutChange: (accelerator: string) => boolean): void {
  ipcMain.handle(IpcChannels.prefsGet, (): Prefs => getPrefs())

  ipcMain.handle(IpcChannels.prefsSet, (_event, patch: Partial<Prefs>): PrefsSetResult => {
    const current = getPrefs()

    if (patch.captureShortcut && patch.captureShortcut !== current.captureShortcut) {
      if (!onShortcutChange(patch.captureShortcut)) {
        // Roll back: put the old accelerator back in place.
        onShortcutChange(current.captureShortcut)
        return {
          ok: false,
          error: `Could not register "${patch.captureShortcut}" — it may be in use by another app.`,
          prefs: current
        }
      }
    }

    store.set({ ...current, ...patch })
    return { ok: true, prefs: getPrefs() }
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
