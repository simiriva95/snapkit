import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { existsSync } from 'fs'
import { mkdir, readdir, rm, stat, writeFile } from 'fs/promises'
import { basename, extname, join, parse } from 'path'
import {
  IpcChannels,
  type VideoExportRequest,
  type VideoExportResult,
  type VideoOpenPayload
} from '@shared/ipc'
import { planExport } from '@shared/videoPlan'
import { ffmpegPath, runFfmpeg } from './ffmpeg'
import { getPrefs } from './prefs'
import { APP_URL } from './protocol'
import { allowVideoPath, videoUrl } from './videoServe'
import { staleRecordings } from './recordingsPrune'

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']
const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'webm', 'mov', 'mkv']

let win: BrowserWindow | null = null
let exportAbort: AbortController | null = null

const containerOf = (path: string): VideoOpenPayload['container'] => {
  const ext = extname(path).toLowerCase()
  return ext === '.mp4' || ext === '.m4v' ? 'mp4' : ext === '.webm' ? 'webm' : 'other'
}

export function initVideo(): void {
  ipcMain.handle(IpcChannels.videoExport, (event, req: VideoExportRequest) =>
    exportVideo(event.sender, req)
  )
  ipcMain.on(IpcChannels.videoCancel, () => exportAbort?.abort())
  ipcMain.handle(IpcChannels.videoPickFile, (event) =>
    pickAndOpenVideo(BrowserWindow.fromWebContents(event.sender) ?? undefined)
  )
  ipcMain.on(IpcChannels.videoOpenPath, (_event, path: string) => {
    if (VIDEO_EXTENSIONS.includes(extname(path).slice(1).toLowerCase())) openVideo(path)
  })
  void pruneRecordings()
}

function ensureWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win
  win = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 12, y: 14 } }
      : { frame: false }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.on('closed', () => {
    win = null
    exportAbort?.abort()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  void win.loadURL(RENDERER_DEV_URL ? `${RENDERER_DEV_URL}/video.html` : `${APP_URL}/video.html`)
  return win
}

export function openVideo(filePath: string): void {
  const w = ensureWindow()
  allowVideoPath(filePath)
  void stat(filePath).then((info) => {
    const payload: VideoOpenPayload = {
      path: filePath,
      url: videoUrl(filePath),
      name: basename(filePath),
      sizeBytes: info.size,
      container: containerOf(filePath),
      ffmpegAvailable: existsSync(ffmpegPath())
    }
    const wc = w.webContents
    const send = (): void => wc.send(IpcChannels.videoOpen, payload)
    if (wc.isLoading()) wc.once('did-finish-load', send)
    else send()
    w.show()
    w.focus()
  })
}

export async function pickAndOpenVideo(parent?: BrowserWindow): Promise<boolean> {
  const options = {
    properties: ['openFile' as const],
    filters: [{ name: 'Video', extensions: VIDEO_EXTENSIONS }]
  }
  const { canceled, filePaths } = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  if (canceled || filePaths.length === 0) return false
  openVideo(filePaths[0])
  return true
}

async function exportVideo(
  sender: Electron.WebContents,
  { path, edits, meta }: VideoExportRequest
): Promise<VideoExportResult> {
  if (exportAbort) return { ok: false, error: 'An export is already running.' }
  const prefs = getPrefs()
  const { name } = parse(path)
  const filters = {
    mp4: { name: 'MP4 video', extensions: ['mp4'] },
    webm: { name: 'WebM video', extensions: ['webm'] },
    gif: { name: 'GIF', extensions: ['gif'] }
  }
  const owner = BrowserWindow.fromWebContents(sender)
  const options = {
    defaultPath: join(
      prefs.exportDir ?? app.getPath('desktop'),
      `${name} (edited).${edits.container}`
    ),
    filters: [filters[edits.container]]
  }
  const { canceled, filePath } = owner
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options)
  if (canceled || !filePath) return { ok: false, error: 'canceled', canceled: true }

  const plan = planExport(edits, meta, path, filePath)
  exportAbort = new AbortController()
  try {
    await runFfmpeg({
      args: plan.args,
      durationSec: Math.max(0.1, edits.outSec - edits.inSec),
      signal: exportAbort.signal,
      onProgress: (ratio) => {
        if (!sender.isDestroyed()) sender.send(IpcChannels.videoProgress, ratio)
      }
    })
    shell.showItemInFolder(filePath)
    return { ok: true, output: filePath }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message, canceled: message === 'ffmpeg cancelled' }
  } finally {
    exportAbort = null
  }
}

/** Where finished recordings live until the user exports them. */
const recordingsDir = (): string => join(app.getPath('userData'), 'recordings')

const pad2 = (n: number): string => String(n).padStart(2, '0')

/**
 * Called by the recorder with the raw MediaRecorder bytes. Remuxes them into
 * a seekable file (fragmented mp4/webm has no duration header) and opens the
 * editor on it. Falls back to the raw bytes if ffmpeg fails.
 */
export async function finalizeRecording(buffer: Buffer, ext: 'mp4' | 'webm'): Promise<void> {
  const d = new Date()
  const stamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} at ${pad2(d.getHours())}.${pad2(d.getMinutes())}.${pad2(d.getSeconds())}`
  const dir = recordingsDir()
  await mkdir(dir, { recursive: true })
  const final = join(dir, `Snapkit Recording ${stamp}.${ext}`)
  const raw = join(dir, `.raw-${Date.now()}.${ext}`)
  try {
    await writeFile(raw, buffer)
    await runFfmpeg({
      args: ['-i', raw, '-c', 'copy', ...(ext === 'mp4' ? ['-movflags', '+faststart'] : []), final]
    })
  } catch (err) {
    console.warn('[video] remux failed, keeping the raw recording:', err)
    try {
      await writeFile(final, buffer)
    } catch (writeErr) {
      new Notification({
        title: 'Could not save recording',
        body: writeErr instanceof Error ? writeErr.message : String(writeErr)
      }).show()
      return
    }
  } finally {
    await rm(raw, { force: true }).catch(() => undefined)
  }
  openVideo(final)
}

// ponytail: 7-day sweep at startup; a "Recordings" browser in the editor if people ask.
async function pruneRecordings(): Promise<void> {
  const dir = recordingsDir()
  const names = await readdir(dir).catch(() => [] as string[])
  const entries = await Promise.all(
    names.map(async (n) => ({ path: join(dir, n), mtimeMs: (await stat(join(dir, n))).mtimeMs }))
  )
  for (const p of staleRecordings(entries, Date.now()))
    await rm(p, { force: true }).catch(() => undefined)
}
