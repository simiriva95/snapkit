/**
 * Typed IPC contract shared between main and renderer.
 * Single source of truth for channel names and the API surface the preload
 * exposes on `window.api` / `window.overlayApi`. No magic strings.
 */

import type { RecordFormat, RecordFps, RecordResolution } from './recordPlan'

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
  prefsPickDir: 'prefs:pick-dir',
  /** renderer ↔ main: license. */
  licenseGet: 'license:get',
  licenseActivate: 'license:activate',
  /** main → picker renderer: list of capturable windows. */
  pickerInit: 'picker:init',
  /** picker renderer → main: chosen window source id. */
  pickerSelect: 'picker:select',
  pickerCancel: 'picker:cancel',
  /** main → control bar: which session it belongs to. */
  controlInit: 'control:init',
  /** main → control bar: live status text (frame count / elapsed). */
  controlStatus: 'control:status',
  /** control bar → main: user pressed done/cancel. */
  controlAction: 'control:action',
  /** main → editor renderer: scrolling capture frames ready to stitch. */
  scrollFrames: 'scroll:frames',
  /** main → recorder renderer: start recording this region. */
  recordStart: 'record:start',
  /** main → recorder renderer: stop and hand back the file. */
  recordStop: 'record:stop',
  /** recorder renderer → main: encoded recording bytes. */
  recordResult: 'record:result',
  /** history panel → main: fetch the clipboard-history entries. */
  historyList: 'history:list',
  /** history panel → main: re-copy an entry to the clipboard (closes panel). */
  historyCopy: 'history:copy',
  /** history panel → main: wipe the whole history. */
  historyClear: 'history:clear',
  /** history panel → main: pin/unpin an entry (survives eviction, sorts first). */
  historyPin: 'history:pin',
  /** history panel → main: delete a single entry. */
  historyDelete: 'history:delete',
  /** main → history panel: entries changed, re-fetch. */
  historyChanged: 'history:changed',
  /** history panel → main: dismiss the panel (Esc). */
  historyCancel: 'history:cancel',
  /** main → hidden OCR window: recognize text in this image. */
  ocrRun: 'ocr:run',
  /** OCR window → main: recognized text for a request. */
  ocrResult: 'ocr:result'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

/** Default global shortcut for area capture (configurable at M5). */
export const DEFAULT_CAPTURE_SHORTCUT = 'CommandOrControl+Shift+2'

/** Default global shortcut for the clipboard-history panel (Win+V-style). */
export const DEFAULT_HISTORY_SHORTCUT = 'CommandOrControl+Shift+V'

/** Capture entry points. */
export type CaptureMode = 'area' | 'fullscreen' | 'window' | 'scrolling' | 'record'

/** What a floating control bar is controlling. */
export type ControlMode = 'scroll' | 'record'

/** Scrolling capture: frames to stitch, handed to the editor renderer. */
export interface ScrollFramesPayload {
  /** Region crops (PNG data URLs, HiDPI px), oldest first. */
  frames: string[]
  /** Selection width in CSS px — used to derive display dimensions. */
  dipWidth: number
}

/** What kind of source a recording job captures. */
export type RecordSource = 'area' | 'screen' | 'window'

/** Recording job sent to the hidden recorder window. */
export interface RecordJob {
  source: RecordSource
  /** area only: selection in display CSS px. */
  rect?: Rect
  /** DIP size of the display being recorded (maps video px → rect px). */
  displaySize: { width: number; height: number }
  format: RecordFormat
  resolution: RecordResolution
  fps: RecordFps
  mic: boolean
  systemAudio: boolean
  /** Hard stop after this many seconds. */
  maxSeconds: number
}

/** One capturable window shown in the picker grid. */
export interface WindowSource {
  id: string
  name: string
  /** Small JPEG preview for the grid. */
  thumbnailDataUrl: string
}

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

/** One clipboard-history item shown in the panel. */
export interface HistoryEntry {
  id: string
  type: 'text' | 'image'
  /** text entries: the copied text. */
  text?: string
  /** image entries: thumbnail data URL for the grid. */
  thumbDataUrl?: string
  /** ms epoch of when it was captured. */
  ts: number
  /** pinned entries sort first and are never auto-evicted. */
  pinned: boolean
  /** image entries: text extracted by OCR, so search can find screenshots. */
  ocrText?: string
}

/** A pending OCR job handed to the hidden OCR window. */
export interface OcrJob {
  id: string
  dataUrl: string
  langs: string[]
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
  /** Kick off a capture (hides the window first). Default mode: area. */
  startCapture: (mode?: CaptureMode) => void
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
  /** Current license/trial status. */
  getLicense: () => Promise<import('./license').LicenseStatus>
  /** Try to activate a license key (validated locally). */
  activateLicense: (key: string) => Promise<import('./license').LicenseActivateResult>
  /** Scrolling capture finished: frames ready for stitching. Returns unsubscribe. */
  onScrollFrames: (cb: (payload: ScrollFramesPayload) => void) => () => void
}

/** The API bridged into the clipboard-history panel window. */
export interface HistoryApi {
  list: () => Promise<HistoryEntry[]>
  /** Re-copy an entry; main closes the panel afterwards. */
  copy: (id: string) => void
  /** Toggle pin on an entry. */
  pin: (id: string) => void
  /** Delete a single entry. */
  remove: (id: string) => void
  clear: () => void
  /** Notified when the history changes while the panel is open. */
  onChanged: (cb: () => void) => () => void
  /** Dismiss the panel. */
  cancel: () => void
}

/** The API bridged into the hidden OCR-indexing window. */
export interface OcrApi {
  onRun: (cb: (job: OcrJob) => void) => () => void
  sendResult: (id: string, text: string) => void
}

/** The API bridged into the floating control bar window. */
export interface ControlApi {
  onInit: (cb: (payload: { mode: ControlMode }) => void) => () => void
  onStatus: (cb: (payload: { text: string }) => void) => () => void
  action: (action: 'done' | 'cancel') => void
}

/** The API bridged into the hidden recorder window. */
export interface RecorderApi {
  onStart: (cb: (job: RecordJob) => void) => () => void
  onStop: (cb: () => void) => () => void
  /** Hand the encoded bytes back to main for saving. */
  sendResult: (data: ArrayBuffer, ext: string) => void
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

/** The API bridged into the window-picker window. */
export interface PickerApi {
  /** Receive the capturable window list. Returns unsubscribe. */
  onInit: (cb: (payload: { sources: WindowSource[] }) => void) => () => void
  /** Capture this window. */
  select: (id: string) => void
  /** Abort. */
  cancel: () => void
}
