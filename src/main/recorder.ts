import {
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Notification,
  session as electronSession,
  systemPreferences,
  webContents,
  type Display
} from 'electron'
import os from 'os'
import { join } from 'path'
import { IpcChannels, type Rect, type RecordJob } from '@shared/ipc'
import type { RecordFormat } from '@shared/recordPlan'
import { getPrefs } from './prefs'
import { createControlBar, sendControlStatus } from './controlbar'
import { APP_URL } from './protocol'
import { finalizeRecording } from './video'

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']

const MAX_SECONDS = 300

/** What to record. `display` is where the control bar goes and, for area/screen, what is captured. */
export type RecordTarget =
  | { source: 'area'; display: Display; rect: Rect }
  | { source: 'screen'; display: Display }
  | { source: 'window'; display: Display; sourceId: string }

interface RecordSession {
  recorder: BrowserWindow
  control: BrowserWindow
  timer: NodeJS.Timeout
  stopping: boolean
}

/**
 * Can we ask for `audio: 'loopback'` (system audio) at all? Only macOS 13+
 * (Darwin 22) and Windows. On Linux and macOS ≤ 12 the request either fails or
 * is ignored, so we silently record without system audio instead.
 */
export function systemAudioSupported(): boolean {
  return (
    process.platform === 'win32' ||
    (process.platform === 'darwin' && Number(os.release().split('.')[0]) >= 22)
  )
}

let current: RecordSession | null = null

export interface PendingSource {
  displayId: number
  sourceId?: string
  audio: boolean
}
/**
 * Source each hidden window (recorder, replay) may capture, keyed by its
 * webContents id and consumed by its own getDisplayMedia request. Keyed, not a
 * single slot: two windows starting close together must never swap sources.
 */
const pendingSources = new Map<number, PendingSource>()

export function setPendingSource(webContentsId: number, s: PendingSource): void {
  pendingSources.set(webContentsId, s)
}
/** Drop an unconsumed grant (the window went away before asking). */
export function clearPendingSource(webContentsId: number): void {
  pendingSources.delete(webContentsId)
}

const stateListeners = new Set<(recording: boolean) => void>()
export function onRecordingStateChange(cb: (recording: boolean) => void): void {
  stateListeners.add(cb)
}
const emitState = (): void => stateListeners.forEach((cb) => cb(current !== null))
export function isRecording(): boolean {
  return current !== null
}
export function stopCurrentRecording(): void {
  stopRecording()
}

/** Route the recorder's getDisplayMedia() to the chosen display or window, no picker. */
export function setupDisplayMediaHandler(): void {
  electronSession.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const requester = request.frame ? webContents.fromFrame(request.frame)?.id : undefined
    const pending = requester !== undefined ? pendingSources.get(requester) : undefined
    if (requester !== undefined) pendingSources.delete(requester) // one-shot
    // No grant for this window = a getDisplayMedia call we did not initiate: deny it.
    if (!pending) return callback({})
    desktopCapturer
      // Thumbnails/icons are pure overhead here — we only need the source handle.
      .getSources({
        types: pending.sourceId ? ['window'] : ['screen'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false
      })
      .then((sources) => {
        const match = pending.sourceId
          ? sources.find((s) => s.id === pending.sourceId)
          : sources.find((s) => s.display_id === String(pending.displayId))
        // No match: deny rather than record a random screen.
        if (!match) return callback({})
        // 'loopback' = system audio. Works on macOS 13+ and Windows (V0 spike).
        callback(pending.audio ? { video: match, audio: 'loopback' } : { video: match })
      })
      .catch(() => callback({}))
  })
}

export function registerRecorderIpc(): void {
  ipcMain.on(IpcChannels.controlAction, (event, action: 'done' | 'cancel') => {
    if (current && current.control.webContents.id === event.sender.id) {
      if (action === 'done') stopRecording()
      else cancelRecording()
    }
  })

  ipcMain.on(
    IpcChannels.recordResult,
    (event, data: ArrayBuffer, ext: RecordFormat, error?: string) => {
      if (!current || current.recorder.webContents.id !== event.sender.id) return
      const buffer = Buffer.from(data)
      teardown()
      // Nothing was encoded (permission denied, no track, encoder error before
      // the first chunk): tell the user instead of opening a save dialog for 0 bytes.
      if (buffer.byteLength === 0) {
        new Notification({
          title: 'Recording failed',
          body: error ?? 'No video data was produced.'
        }).show()
        return
      }
      void finalizeRecording(buffer, ext).catch((err) =>
        new Notification({
          title: 'Could not save recording',
          body: err instanceof Error ? err.message : String(err)
        }).show()
      )
    }
  )
}

export function startRecording(target: RecordTarget): void {
  if (current) return
  void begin(target)
}

async function begin(target: RecordTarget): Promise<void> {
  const prefs = getPrefs()
  let mic = prefs.recordMic
  if (mic && process.platform === 'darwin') {
    // First call shows the OS prompt (needs NSMicrophoneUsageDescription in the bundle).
    mic = await systemPreferences.askForMediaAccess('microphone')
    if (!mic) {
      new Notification({
        title: 'Recording without microphone',
        body: 'Allow Snapkit in System Settings → Privacy & Security → Microphone to include your voice.'
      }).show()
    }
  }
  if (current) return
  const { display } = target

  // Linux and macOS ≤ 12 have no loopback capture: those recordings are
  // silently made without system audio rather than failing.
  const systemAudio = prefs.recordSystemAudio && systemAudioSupported()

  const recorder = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // The window is hidden but drives the canvas RAF loop for area recordings.
      backgroundThrottling: false
    }
  })
  setPendingSource(recorder.webContents.id, {
    displayId: display.id,
    sourceId: target.source === 'window' ? target.sourceId : undefined,
    audio: systemAudio
  })

  // Control bar: under the area, or on the recorded display for screen/window.
  // ponytail: for screen/window the bar is inside the recording — see ROADMAP.
  const region =
    target.source === 'area'
      ? {
          x: display.bounds.x + Math.round(target.rect.x),
          y: display.bounds.y + Math.round(target.rect.y),
          width: Math.round(target.rect.width),
          height: Math.round(target.rect.height)
        }
      : display.bounds
  const control = createControlBar('record', region)

  const job: RecordJob = {
    source: target.source,
    rect: target.source === 'area' ? target.rect : undefined,
    displaySize: { width: display.size.width, height: display.size.height },
    format: prefs.recordFormat,
    resolution: prefs.recordResolution,
    fps: prefs.recordFps,
    mic,
    systemAudio
  }
  recorder.webContents.once('did-finish-load', () => {
    recorder.webContents.send(IpcChannels.recordStart, job)
  })
  void recorder.loadURL(
    RENDERER_DEV_URL ? `${RENDERER_DEV_URL}/recorder.html` : `${APP_URL}/recorder.html`
  )

  const startedAt = Date.now()
  const timer = setInterval(() => {
    if (!current) return
    const elapsed = Math.floor((Date.now() - startedAt) / 1000)
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
    const ss = String(elapsed % 60).padStart(2, '0')
    sendControlStatus(current.control, `${mm}:${ss}`)
    if (elapsed >= MAX_SECONDS) stopRecording()
  }, 500)

  const onDied = (): void => {
    if (current && (current.recorder.isDestroyed() || current.control.isDestroyed())) {
      teardown()
    }
  }
  recorder.on('closed', onDied)
  control.on('closed', onDied)

  current = { recorder, control, timer, stopping: false }
  emitState()
}

function stopRecording(): void {
  if (!current || current.stopping) return
  current.stopping = true
  const session = current
  // The recorder answers with recordResult; teardown happens there.
  current.recorder.webContents.send(IpcChannels.recordStop)
  // Safety net: if the renderer never answers, kill the session. Compare
  // identity so a stale timer can never tear down a later recording.
  setTimeout(() => {
    if (current === session && session.stopping) teardown()
  }, 15_000)
}

function cancelRecording(): void {
  teardown()
}

function teardown(): void {
  if (!current) return
  const { recorder, control, timer } = current
  current = null
  clearInterval(timer)
  if (!recorder.isDestroyed()) clearPendingSource(recorder.webContents.id)
  if (!recorder.isDestroyed()) recorder.destroy()
  if (!control.isDestroyed()) control.destroy()
  emitState()
}
