import { Tray, Menu, nativeImage, type NativeImage } from 'electron'
import type { Prefs } from '@shared/prefs'
// electron-vite copies these next to the bundle and rewrites the paths (?asset).
import trayIconPath from '../../resources/tray-iconTemplate.png?asset'
import trayIconRecPath from '../../resources/tray-icon-rec.png?asset'

export interface TrayActions {
  show: () => void
  captureArea: () => void
  captureFullscreen: () => void
  captureWindow: () => void
  captureScrolling: () => void
  recordArea: () => void
  recordScreen: () => void
  recordWindow: () => void
  stopRecording: () => void
  saveReplay: () => void
  editVideo: () => void
  clipboardHistory: () => void
  quit: () => void
}

/** What the tray reflects: a running recording or replay buffer shows the red-dot icon. */
export interface TrayState {
  recording: boolean
  replayRunning: boolean
}

type TrayPrefs = Pick<
  Prefs,
  | 'captureShortcut'
  | 'fullscreenShortcut'
  | 'windowShortcut'
  | 'scrollingShortcut'
  | 'recordShortcut'
  | 'recordScreenShortcut'
  | 'recordWindowShortcut'
  | 'replayShortcut'
  | 'replayBuffer'
  | 'historyShortcut'
>

// Keep module-level refs so the tray isn't garbage-collected.
let tray: Tray | null = null
let actionsRef: TrayActions | null = null
let prefsRef: TrayPrefs | null = null
let stateRef: TrayState = { recording: false, replayRunning: false }
let idleIcon: NativeImage | null = null
let recIcon: NativeImage | null = null

function buildMenu(prefs: TrayPrefs, state: TrayState): Menu {
  const actions = actionsRef
  if (!actions) throw new Error('tray menu built before createTray')
  return Menu.buildFromTemplate([
    // Accelerators are display hints only — real registration is in shortcuts.ts.
    { label: 'Capture Area', accelerator: prefs.captureShortcut, click: actions.captureArea },
    {
      label: 'Capture Full Screen',
      accelerator: prefs.fullscreenShortcut,
      click: actions.captureFullscreen
    },
    { label: 'Capture Window', accelerator: prefs.windowShortcut, click: actions.captureWindow },
    {
      label: 'Scrolling Capture',
      accelerator: prefs.scrollingShortcut,
      click: actions.captureScrolling
    },
    { type: 'separator' },
    { label: 'Record Area…', accelerator: prefs.recordShortcut, click: actions.recordArea },
    {
      label: 'Record Screen',
      accelerator: prefs.recordScreenShortcut,
      click: actions.recordScreen
    },
    {
      label: 'Record Window…',
      accelerator: prefs.recordWindowShortcut,
      click: actions.recordWindow
    },
    { label: 'Stop Recording', enabled: state.recording, click: actions.stopRecording },
    {
      label:
        prefs.replayBuffer > 0
          ? `Save Replay (${prefs.replayBuffer} s)`
          : 'Save Replay (buffer off)',
      accelerator: prefs.replayShortcut,
      enabled: state.replayRunning,
      click: actions.saveReplay
    },
    { label: 'Edit Video…', click: actions.editVideo },
    { type: 'separator' },
    {
      label: 'Clipboard History',
      accelerator: prefs.historyShortcut,
      click: actions.clipboardHistory
    },
    { type: 'separator' },
    { label: 'Open Snapkit', click: actions.show },
    { type: 'separator' },
    { label: 'Quit Snapkit', click: actions.quit }
  ])
}

function refresh(): void {
  if (!tray || !prefsRef) return
  tray.setContextMenu(buildMenu(prefsRef, stateRef))
  const busy = stateRef.recording || stateRef.replayRunning
  const icon = busy ? recIcon : idleIcon
  if (icon) tray.setImage(icon)
}

export function createTray(actions: TrayActions, prefs: TrayPrefs): Tray {
  actionsRef = actions
  prefsRef = prefs
  idleIcon = nativeImage.createFromPath(trayIconPath)
  // macOS: a template image auto-adapts to light/dark menu bars. The recording
  // variant is full-colour (grey glyph + red dot) and must stay non-template.
  if (process.platform === 'darwin') idleIcon.setTemplateImage(true)
  recIcon = nativeImage.createFromPath(trayIconRecPath)

  tray = new Tray(idleIcon)
  tray.setToolTip('Snapkit')
  tray.setContextMenu(buildMenu(prefs, stateRef))
  // Left-click (or click on non-macOS) opens the window.
  tray.on('click', actions.show)

  return tray
}

/** Reflect shortcut / replay-length changes in the tray menu. */
export function updateTrayShortcuts(prefs: TrayPrefs): void {
  prefsRef = prefs
  refresh()
}

/** Reflect recording / replay state: menu enablement and the icon. */
export function updateTrayState(patch: Partial<TrayState>): void {
  stateRef = { ...stateRef, ...patch }
  refresh()
}
