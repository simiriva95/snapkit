import { app, dialog } from 'electron'

/** Marks a login-item launch on Windows (macOS reports `wasOpenedAtLogin`). */
const HIDDEN_FLAG = '--hidden'

/**
 * Register/unregister Snapkit as an OS login item.
 *
 * Dev builds are skipped: the item would point at the shared Electron binary,
 * not at Snapkit. Linux has no Electron implementation → no-op there.
 * Pass `notify` when the user just flipped the pref, so macOS can tell them
 * the item is parked in System Settings instead of failing silently.
 */
export function applyLaunchAtLogin(enabled: boolean, notify = false): void {
  if (!app.isPackaged || process.platform === 'linux') return
  app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_FLAG] })

  if (!enabled || !notify || process.platform !== 'darwin') return
  if (app.getLoginItemSettings().status !== 'requires-approval') return
  // Background apps don't get dialogs brought forward on macOS.
  app.focus({ steal: true })
  void dialog.showMessageBox({
    type: 'info',
    message: 'Approve Snapkit in Login Items',
    detail:
      'macOS needs your approval before Snapkit can start at login. Open System Settings → General → Login Items & Extensions and enable Snapkit.'
  })
}

/** True when the OS started us at login — stay in the tray, open no window. */
export function launchedAtLogin(argv: string[] = process.argv): boolean {
  // macOS 13+ dropped openAsHidden and ignores `args`; wasOpenedAtLogin is the signal.
  if (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin) return true
  return argv.includes(HIDDEN_FLAG)
}
