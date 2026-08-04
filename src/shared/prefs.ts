import { DEFAULT_CAPTURE_SHORTCUT, DEFAULT_HISTORY_SHORTCUT } from './ipc'

/** User preferences, persisted by electron-store in the main process. */
export interface Prefs {
  /** Electron accelerator for area capture. */
  captureShortcut: string
  /** Electron accelerator for full-screen capture. */
  fullscreenShortcut: string
  /** Electron accelerator for window capture (opens the picker). */
  windowShortcut: string
  /** Electron accelerator for scrolling capture. */
  scrollingShortcut: string
  /** Electron accelerator for area screen recording. */
  recordShortcut: string
  theme: 'dark' | 'light' | 'system'
  /** Default folder for the save dialog. null = OS desktop. */
  exportDir: string | null
  /** Preferred format preselected in the save dialog. */
  exportFormat: 'png' | 'jpg'
  /** Backdrop preset for "styled copy" (see editor/exporter.ts). */
  styledTemplate: string
  /** Run the sensitive-data scan automatically after each capture. */
  autoRedactOnCapture: boolean
  /** OCR languages (tesseract codes). Bundled: eng, ita, deu, fra, spa. */
  ocrLanguages: string[]
  /** Screen recording output. GIF is capped at 30s, WebM at 5min. */
  recordFormat: 'webm' | 'gif'
  /** Copy each new capture to the OS clipboard automatically. */
  autoCopyOnCapture: boolean
  /** Track everything copied (text + images) in a browsable history. */
  clipboardHistory: boolean
  /** Electron accelerator that opens the clipboard-history panel. */
  historyShortcut: string
  /** After picking a history entry, paste it into the focused app (needs OS accessibility permission). */
  autoPaste: boolean
  /** Start Snapkit in the tray when the user logs in. Packaged builds only. */
  launchAtLogin: boolean
  onboardingDone: boolean
}

export const DEFAULT_PREFS: Prefs = {
  captureShortcut: DEFAULT_CAPTURE_SHORTCUT,
  fullscreenShortcut: 'CommandOrControl+Shift+1',
  windowShortcut: 'CommandOrControl+Shift+3',
  // 4 and 5 are macOS system screenshot shortcuts — skip them.
  scrollingShortcut: 'CommandOrControl+Shift+6',
  recordShortcut: 'CommandOrControl+Shift+7',
  theme: 'dark',
  exportDir: null,
  exportFormat: 'png',
  styledTemplate: 'indigo',
  autoRedactOnCapture: false,
  ocrLanguages: ['eng'],
  recordFormat: 'webm',
  autoCopyOnCapture: true,
  clipboardHistory: true,
  historyShortcut: DEFAULT_HISTORY_SHORTCUT,
  autoPaste: false,
  launchAtLogin: false,
  onboardingDone: false
}

/** Languages shipped with the app (see src/renderer/public/ocr/lang). */
export const BUNDLED_OCR_LANGUAGES = [
  { code: 'eng', label: 'English' },
  { code: 'ita', label: 'Italiano' },
  { code: 'deu', label: 'Deutsch' },
  { code: 'fra', label: 'Français' },
  { code: 'spa', label: 'Español' }
] as const

/** Outcome of a prefs update — shortcut changes can fail to register. */
export type PrefsSetResult = { ok: true; prefs: Prefs } | { ok: false; error: string; prefs: Prefs }
