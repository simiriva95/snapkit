import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  session as electronSession,
  shell,
  type Display
} from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { IpcChannels, type Rect, type RecordJob } from '@shared/ipc'
import { getPrefs } from './prefs'
import { createControlBar, sendControlStatus } from './controlbar'
import { APP_URL } from './protocol'
import type { EditorHost } from './capture'

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
  startedAt: number
  ext: string
  stopping: boolean
}

let current: RecordSession | null = null
/** What the in-flight getDisplayMedia request should receive (set by startRecording). */
let pendingSource: { displayId: number; sourceId?: string; audio: boolean } | null = null

/** Route the recorder's getDisplayMedia() to the chosen display or window, no picker. */
export function setupDisplayMediaHandler(): void {
  electronSession.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    const pending = pendingSource
    desktopCapturer
      .getSources({ types: pending?.sourceId ? ['window', 'screen'] : ['screen'] })
      .then((sources) => {
        const match = pending?.sourceId
          ? sources.find((s) => s.id === pending.sourceId)
          : (sources.find((s) => s.display_id === String(pending?.displayId)) ?? sources[0])
        if (!match) return callback({})
        // 'loopback' = system audio. Works on macOS 13+ and Windows (V0 spike).
        callback(pending?.audio ? { video: match, audio: 'loopback' } : { video: match })
      })
      .catch(() => callback({}))
  })
}

export function registerRecorderIpc(host: EditorHost): void {
  ipcMain.on(IpcChannels.controlAction, (event, action: 'done' | 'cancel') => {
    if (current && current.control.webContents.id === event.sender.id) {
      if (action === 'done') stopRecording()
      else cancelRecording()
    }
  })

  ipcMain.on(IpcChannels.recordResult, (event, data: ArrayBuffer, ext: string) => {
    if (!current || current.recorder.webContents.id !== event.sender.id) return
    const buffer = Buffer.from(data)
    teardown()
    void saveRecording(buffer, ext, host)
  })
}

export function startRecording(target: RecordTarget): void {
  if (current) return
  const prefs = getPrefs()
  const { display } = target

  pendingSource = {
    displayId: display.id,
    sourceId: target.source === 'window' ? target.sourceId : undefined,
    audio: prefs.recordSystemAudio
  }

  const recorder = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
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
    mic: prefs.recordMic,
    systemAudio: prefs.recordSystemAudio,
    maxSeconds: MAX_SECONDS
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

  current = { recorder, control, timer, startedAt, ext: prefs.recordFormat, stopping: false }
}

function stopRecording(): void {
  if (!current || current.stopping) return
  current.stopping = true
  // The recorder answers with recordResult; teardown happens there.
  current.recorder.webContents.send(IpcChannels.recordStop)
  // Safety net: if the renderer never answers, kill the session.
  setTimeout(() => {
    if (current?.stopping) teardown()
  }, 15_000)
}

function cancelRecording(): void {
  teardown()
}

function teardown(): void {
  if (!current) return
  const { recorder, control, timer } = current
  current = null
  pendingSource = null
  clearInterval(timer)
  if (!recorder.isDestroyed()) recorder.destroy()
  if (!control.isDestroyed()) control.destroy()
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

async function saveRecording(buffer: Buffer, ext: string, host: EditorHost): Promise<void> {
  const d = new Date()
  const name = `Snapkit Recording ${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} at ${pad2(d.getHours())}.${pad2(d.getMinutes())}.${pad2(d.getSeconds())}.${ext}`
  const prefs = getPrefs()
  const dir = prefs.exportDir ?? app.getPath('desktop')

  const win = host.peek()
  const options = {
    defaultPath: join(dir, name),
    filters: [
      ext === 'webm'
        ? { name: 'WebM video', extensions: ['webm'] }
        : { name: 'MP4 video', extensions: ['mp4'] }
    ]
  }
  const { canceled, filePath } = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)
  if (canceled || !filePath) return
  await writeFile(filePath, buffer)
  shell.showItemInFolder(filePath)
}
