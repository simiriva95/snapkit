/**
 * Typed IPC contract shared between main and renderer.
 * Single source of truth for channel names and the API surface the preload
 * exposes on `window.api` / `window.overlayApi`. No magic strings.
 */

export const IpcChannels = {
  appVersion: 'app:version',
  windowHide: 'window:hide',
  /** renderer → main: start an area capture (also fired by the global shortcut). */
  captureStart: 'capture:start',
  /** main → editor renderer: a capture finished, here is the image. */
  captureCaptured: 'capture:captured',
  /** main → overlay renderer: frozen screen preview to draw the selection on. */
  overlayInit: 'overlay:init',
  /** overlay renderer → main: user confirmed a selection rectangle. */
  overlaySelect: 'overlay:select',
  /** overlay renderer → main: user cancelled (Esc / empty selection). */
  overlayCancel: 'overlay:cancel',
  /** renderer → main: save image to disk (dialog). */
  exportSave: 'export:save',
  /** renderer → main: copy image to the OS clipboard. */
  exportCopy: 'export:copy',
  /** renderer ↔ main: preferences. */
  prefsGet: 'prefs:get',
  prefsSet: 'prefs:set',
  prefsPickDir: 'prefs:pick-dir'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

/** Default global shortcut for area capture (configurable at M5). */
export const DEFAULT_CAPTURE_SHORTCUT = 'CommandOrControl+Shift+2'

/** Selection rectangle in display-local CSS pixels (DIP). */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A finished capture, handed to the editor. */
export interface CapturePayload {
  /** PNG data URL of the cropped area. */
  dataUrl: string
  /** Size in CSS pixels (DIP) — the image itself may be larger on HiDPI. */
  width: number
  height: number
}

/** Outcome of a save-to-file export. */
export type ExportSaveResult =
  { status: 'saved'; path: string } | { status: 'canceled' } | { status: 'error'; message: string }

/** The API bridged into the main window via contextBridge (see preload). */
export interface SnapkitApi {
  /** App version string, read from the main process. */
  getVersion: () => Promise<string>
  /** Hide the main window (app keeps running in the tray). */
  hideWindow: () => void
  /** Kick off an area capture (hides the window first). */
  startCapture: () => void
  /** Subscribe to finished captures. Returns an unsubscribe function. */
  onCapture: (cb: (payload: CapturePayload) => void) => () => void
  /** Save a PNG data URL to disk (native dialog; .jpg path = auto-convert). */
  exportSave: (dataUrl: string) => Promise<ExportSaveResult>
  /** Put the image on the OS clipboard. */
  exportCopy: (dataUrl: string) => Promise<void>
  /** Read the persisted preferences. */
  getPrefs: () => Promise<import('./prefs').Prefs>
  /** Patch preferences (validates shortcut changes). */
  setPrefs: (patch: Partial<import('./prefs').Prefs>) => Promise<import('./prefs').PrefsSetResult>
  /** Native directory picker for the export folder. null = canceled. */
  pickExportDir: () => Promise<string | null>
}

/** The API bridged into the selection overlay window. */
export interface OverlayApi {
  /** Receive the frozen screen preview (JPEG data URL). Returns unsubscribe. */
  onInit: (cb: (payload: { dataUrl: string }) => void) => () => void
  /** Confirm the selected rectangle. */
  select: (rect: Rect) => void
  /** Abort the capture. */
  cancel: () => void
}
