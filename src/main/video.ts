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
import { containerFromName, planExport } from '@shared/videoPlan'
import { ffmpegPath, runFfmpeg } from './ffmpeg'
import { getPrefs } from './prefs'
import { APP_URL } from './protocol'
import { allowVideoPath, isVideoPathAllowed, resetVideoAllowList, videoUrl } from './videoServe'
import { staleRecordings } from './recordingsPrune'

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']
/** What the picker offers and what a dropped path may be — Chromium cannot decode mkv. */
const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'webm', 'mov']

let win: BrowserWindow | null = null
let exportAbort: AbortController | null = null

const containerOf = (path: string): VideoOpenPayload['container'] => containerFromName(path)

/** Only the editor window may drive an export or hand us a path to open. */
const fromEditor = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
  !!win && !win.isDestroyed() && event.sender.id === win.webContents.id

export function initVideo(): void {
  ipcMain.handle(IpcChannels.videoExport, (event, req: VideoExportRequest) =>
    fromEditor(event)
      ? exportVideo(event.sender, req)
      : ({ ok: false, error: 'Not allowed.' } satisfies VideoExportResult)
  )
  ipcMain.on(IpcChannels.videoCancel, (event) => {
    if (fromEditor(event)) exportAbort?.abort()
  })
  ipcMain.handle(IpcChannels.videoPickFile, (event) =>
    pickAndOpenVideo(BrowserWindow.fromWebContents(event.sender) ?? undefined)
  )
  ipcMain.on(IpcChannels.videoOpenPath, (event, path: string) => {
    if (!fromEditor(event)) return
    if (!VIDEO_EXTENSIONS.includes(extname(path).slice(1).toLowerCase())) return
    void stat(path)
      .catch(() => null)
      .then((info) => {
        if (info?.isFile()) openVideo(path)
      })
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
  // One file open at a time: the previous path stops being servable.
  resetVideoAllowList()
  allowVideoPath(filePath)
  // Show before the stat so a failing stat can never leave an invisible window.
  w.show()
  w.focus()
  void stat(filePath)
    .then((info) => {
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
    })
    .catch((err) => {
      new Notification({
        title: 'Cannot open video',
        body: err instanceof Error ? err.message : String(err)
      }).show()
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
  // The renderer only ever exports the file main handed it; re-check, since the
  // path travels through IPC.
  if (!isVideoPathAllowed(path)) return { ok: false, error: 'Unknown source file.' }
  // Claimed before the dialog so a second request is refused and a Cancel that
  // arrives while the dialog is up is not lost. The finally below still clears it.
  exportAbort = new AbortController()
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
  const abort = exportAbort
  try {
    const { canceled, filePath } = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options)
    if (canceled || !filePath) return { ok: false, error: 'canceled', canceled: true }
    // Cancel pressed while the dialog was open.
    if (abort.signal.aborted) return { ok: false, error: 'canceled', canceled: true }

    const plan = planExport(edits, meta, path, filePath)
    await runFfmpeg({
      args: plan.args,
      durationSec: Math.max(0.1, edits.outSec - edits.inSec),
      signal: abort.signal,
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
// NOTE: the sweep deletes ANY file older than 7 days in that folder, not only
// the ones Snapkit wrote — the directory is ours, so nothing else belongs there.
async function pruneRecordings(): Promise<void> {
  const dir = recordingsDir()
  const names = await readdir(dir).catch(() => [] as string[])
  const entries = await Promise.all(
    names.map(async (n) => {
      const p = join(dir, n)
      // A file that vanished between readdir and stat simply drops out.
      const info = await stat(p).catch(() => null)
      return info ? { path: p, mtimeMs: info.mtimeMs } : null
    })
  )
  for (const p of staleRecordings(
    entries.filter((e): e is { path: string; mtimeMs: number } => e !== null),
    Date.now()
  ))
    await rm(p, { force: true }).catch(() => undefined)
}
