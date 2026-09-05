import { DEFAULT_CAPTURE_SHORTCUT, DEFAULT_HISTORY_SHORTCUT } from './ipc'
import type { RecordFormat, RecordFps, RecordResolution } from './recordPlan'

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
  /** Screen recording container. MP4 (H.264 + AAC) plays everywhere; WebM (VP9 + Opus) is smaller. */
  recordFormat: RecordFormat
  /** Output size preset: max box, aspect preserved, never upscaled. */
  recordResolution: RecordResolution
  recordFps: RecordFps
  /** Mix the microphone into recordings. */
  recordMic: boolean
  /** Mix system audio (what you hear) into recordings. */
  recordSystemAudio: boolean
  /** Electron accelerator for full-screen recording. */
  recordScreenShortcut: string
  /** Electron accelerator for window recording (opens the picker). */
  recordWindowShortcut: string
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
  recordFormat: 'mp4',
  recordResolution: 'native',
  recordFps: 30,
  recordMic: false,
  recordSystemAudio: true,
  recordScreenShortcut: 'CommandOrControl+Shift+9',
  recordWindowShortcut: 'CommandOrControl+Shift+0',
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

const RESOLUTIONS: RecordResolution[] = ['native', 1440, 1080, 720]
const FPS: RecordFps[] = [30, 60]

/**
 * Fill gaps from older stores and migrate removed values. 0.4.x could store
 * recordFormat 'gif'; GIF is now an export of the video editor, not a recording format.
 */
export function normalizePrefs(raw: Prefs): Prefs {
  const p: Prefs = { ...DEFAULT_PREFS, ...raw }
  if (p.recordFormat !== 'mp4' && p.recordFormat !== 'webm') p.recordFormat = 'mp4'
  // A stale or hand-edited store must not index the bitrate/box tables with a
  // value that isn't there (undefined bitrate → MediaRecorder throws).
  if (!RESOLUTIONS.includes(p.recordResolution)) p.recordResolution = 'native'
  if (!FPS.includes(p.recordFps)) p.recordFps = 30
  return p
}
