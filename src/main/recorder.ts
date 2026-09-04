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

interface RecordSession {
  recorder: BrowserWindow
  control: BrowserWindow
  timer: NodeJS.Timeout
  startedAt: number
  ext: string
  stopping: boolean
}

let current: RecordSession | null = null
/** Display the in-flight getDisplayMedia request should receive. */
let pendingDisplayId: number | null = null

/** Route renderer getDisplayMedia() to the right screen without a picker. */
export function setupDisplayMediaHandler(): void {
  electronSession.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        const match = sources.find((s) => s.display_id === String(pendingDisplayId)) ?? sources[0]
        callback(match ? { video: match } : {})
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

export function startRecording(display: Display, rect: Rect): void {
  if (current) return
  const prefs = getPrefs()
  const format = prefs.recordFormat
  const maxSeconds = MAX_SECONDS

  pendingDisplayId = display.id

  const recorder = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const control = createControlBar('record', {
    x: display.bounds.x + Math.round(rect.x),
    y: display.bounds.y + Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  })

  const job: RecordJob = {
    rect,
    displaySize: { width: display.size.width, height: display.size.height },
    format,
    maxSeconds
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
    if (elapsed >= maxSeconds) stopRecording()
  }, 500)

  const onDied = (): void => {
    if (current && (current.recorder.isDestroyed() || current.control.isDestroyed())) {
      teardown()
    }
  }
  recorder.on('closed', onDied)
  control.on('closed', onDied)

  current = {
    recorder,
    control,
    timer,
    startedAt,
    ext: format,
    stopping: false
  }
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
  pendingDisplayId = null
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
