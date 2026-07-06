import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * Auto-update via GitHub Releases (publish config in electron-builder.yml).
 * Only meaningful in packaged builds; failures are logged, never surfaced —
 * an unreachable update server must not degrade the app.
 * NOTE: on macOS updates require a signed build (see docs/selling.md).
 */
export function initAutoUpdate(): void {
  if (!app.isPackaged) return
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.warn('[updater] update check failed:', err instanceof Error ? err.message : err)
  })
}
