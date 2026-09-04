import { app, BrowserWindow, ipcMain, Notification, powerMonitor, screen, shell } from 'electron'
import { mkdir, readdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { IpcChannels, type ReplayJob } from '@shared/ipc'
import type { Prefs } from '@shared/prefs'
import type { RecordFormat } from '@shared/recordPlan'
import {
  clipFileName,
  clipStartSec,
  concatListText,
  ringTrim,
  SEGMENT_SEC,
  type Segment
} from '@shared/replayPlan'
import { concatArgs } from '@shared/videoArgs'
import { runFfmpeg } from './ffmpeg'
import { flashRegion } from './flash'
import { getPrefs } from './prefs'
import { APP_URL } from './protocol'
import { setPendingSource, systemAudioSupported } from './recorder'
import { openVideo } from './video'

/**
 * Replay buffer ("save the last N seconds"). A hidden replay.html window
 * records the display under the cursor in 10 s segments; main keeps the newest
 * ones on disk (see replayPlan.ringTrim) and, on the hotkey, flushes the
 * in-progress segment and stream-copies the tail into a clip with ffmpeg.
 */

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']
const FLUSH_TIMEOUT_MS = 5_000
const RESTART_DELAY_MS = 1_500

interface RingBuffer {
  win: BrowserWindow
  dir: string
  segments: Segment[]
  keepMs: number
  seq: number
  ext: RecordFormat | null
  stopping: boolean
}

let buffer: RingBuffer | null = null
let saving = false
let flushSeq = 0
let pendingFlush: { id: number; resolve: () => void } | null = null
const listeners = new Set<(running: boolean) => void>()

export function isReplayRunning(): boolean {
  return buffer !== null
}
export function onReplayStateChange(cb: (running: boolean) => void): void {
  listeners.add(cb)
}
const emit = (): void => listeners.forEach((cb) => cb(buffer !== null))

const ringDir = (): string => join(app.getPath('temp'), 'snapkit-replay')
const clipsDir = (prefs: Prefs): string =>
  prefs.clipsDir ?? join(app.getPath('videos'), 'Snapkit Clips')

export function initReplay(): void {
  ipcMain.on(
    IpcChannels.replaySegment,
    (event, data: ArrayBuffer, durationMs: number, ext: RecordFormat, flushId?: number) => {
      if (!buffer || event.sender.id !== buffer.win.webContents.id) return
      void storeSegment(buffer, Buffer.from(data), durationMs, ext).finally(() => {
        if (flushId !== undefined && pendingFlush?.id === flushId) {
          pendingFlush.resolve()
          pendingFlush = null
        }
      })
    }
  )
  ipcMain.on(IpcChannels.replayError, (event, message: string) => {
    if (!buffer || event.sender.id !== buffer.win.webContents.id) return
    console.warn('[replay] renderer error:', message)
    new Notification({ title: 'Replay buffer restarting', body: message }).show()
    restartLater()
  })
  // The stream dies across sleep and display changes; the renderer notices too,
  // but restarting explicitly keeps the buffer alive without waiting for it.
  powerMonitor.on('resume', restartLater)
  screen.on('display-removed', restartLater)
  applyReplayPrefs(getPrefs())
}

/** Start, stop or resize the buffer to match the prefs. Idempotent. */
export function applyReplayPrefs(prefs: Prefs): void {
  const keepMs = prefs.replayBuffer * 1000
  if (keepMs === 0) {
    if (buffer) void stopBuffer()
    return
  }
  if (buffer) {
    buffer.keepMs = keepMs
    void trimRing(buffer)
    return
  }
  void startBuffer(keepMs)
}

async function startBuffer(keepMs: number): Promise<void> {
  if (buffer) return
  const prefs = getPrefs()
  const dir = ringDir()
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  await mkdir(dir, { recursive: true })
  if (buffer) return // a concurrent start won the race while we were on disk

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const systemAudio = prefs.recordSystemAudio && systemAudioSupported()
  setPendingSource({ displayId: display.id, audio: systemAudio })

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  const job: ReplayJob = {
    displaySize: { width: display.size.width, height: display.size.height },
    resolution: prefs.recordResolution,
    fps: prefs.recordFps,
    // A background buffer must never pop the macOS microphone prompt (e.g. at login).
    mic: prefs.recordMic && process.platform !== 'darwin',
    systemAudio,
    segmentSec: SEGMENT_SEC
  }
  win.webContents.once('did-finish-load', () => win.webContents.send(IpcChannels.replayStart, job))
  void win.loadURL(RENDERER_DEV_URL ? `${RENDERER_DEV_URL}/replay.html` : `${APP_URL}/replay.html`)

  const onDied = (): void => {
    if (buffer?.win === win && !buffer.stopping) {
      buffer = null
      emit()
      restartLater()
    }
  }
  win.on('closed', onDied)
  win.webContents.on('render-process-gone', onDied)

  buffer = { win, dir, segments: [], keepMs, seq: 0, ext: null, stopping: false }
  emit()
}

async function stopBuffer(): Promise<void> {
  const b = buffer
  if (!b) return
  b.stopping = true
  buffer = null
  emit()
  if (!b.win.isDestroyed()) {
    b.win.webContents.send(IpcChannels.replayStop)
    // Give the renderer a moment to release the stream, then drop the window.
    setTimeout(() => {
      if (!b.win.isDestroyed()) b.win.destroy()
    }, 2_000)
  }
  await rm(b.dir, { recursive: true, force: true }).catch(() => undefined)
}

let restartTimer: NodeJS.Timeout | null = null
function restartLater(): void {
  if (restartTimer) return
  restartTimer = setTimeout(() => {
    restartTimer = null
    const prefs = getPrefs()
    if (prefs.replayBuffer === 0) return
    void (buffer ? stopBuffer() : Promise.resolve()).then(() =>
      startBuffer(prefs.replayBuffer * 1000)
    )
  }, RESTART_DELAY_MS)
}

async function storeSegment(
  b: RingBuffer,
  bytes: Buffer,
  durationMs: number,
  ext: RecordFormat
): Promise<void> {
  if (bytes.byteLength === 0) return
  b.ext = ext
  const path = join(b.dir, `seg-${String(b.seq++).padStart(6, '0')}.${ext}`)
  try {
    await writeFile(path, bytes)
  } catch (err) {
    // Disk full or temp dir gone: stop rather than loop on failures.
    new Notification({
      title: 'Replay buffer stopped',
      body: err instanceof Error ? err.message : String(err)
    }).show()
    await stopBuffer()
    return
  }
  if (buffer !== b) {
    // Stopped while writing.
    await rm(path, { force: true }).catch(() => undefined)
    return
  }
  b.segments.push({ path, durationMs })
  await trimRing(b)
}

async function trimRing(b: RingBuffer): Promise<void> {
  const { keep, drop } = ringTrim(b.segments, b.keepMs)
  b.segments = keep
  await Promise.all(drop.map((s) => rm(s.path, { force: true }).catch(() => undefined)))
}

/** Ask the renderer to close the in-progress segment; resolves when it arrived (or on timeout). */
function flush(b: RingBuffer): Promise<void> {
  return new Promise((resolve) => {
    const id = ++flushSeq
    const timer = setTimeout(() => {
      if (pendingFlush?.id === id) pendingFlush = null
      resolve()
    }, FLUSH_TIMEOUT_MS)
    pendingFlush = {
      id,
      resolve: () => {
        clearTimeout(timer)
        resolve()
      }
    }
    if (!b.win.isDestroyed()) b.win.webContents.send(IpcChannels.replayFlush, id)
    else resolve()
  })
}

/** The hotkey: flush, concat the ring's tail, save, notify. */
export function saveReplay(): void {
  const b = buffer
  if (!b || saving) return
  saving = true
  void (async () => {
    const prefs = getPrefs()
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    flashRegion(display.bounds)
    new Notification({ title: 'Saving clip…', silent: true }).show()

    await flush(b)
    if (b.segments.length === 0 || !b.ext) {
      new Notification({
        title: 'Nothing to save yet',
        body: 'The replay buffer is still warming up.'
      }).show()
      return
    }
    const segments = [...b.segments]
    const totalMs = segments.reduce((acc, s) => acc + s.durationMs, 0)
    const list = join(b.dir, `clip-${Date.now()}.txt`)
    const dir = clipsDir(prefs)
    const out = join(dir, clipFileName(new Date(), b.ext))
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(list, concatListText(segments.map((s) => s.path)))
      await runFfmpeg({
        args: concatArgs(list, out, clipStartSec(totalMs, b.keepMs)),
        durationSec: Math.min(totalMs, b.keepMs) / 1000
      })
      const done = new Notification({ title: 'Clip saved', body: out, silent: true })
      done.on('click', () => shell.showItemInFolder(out))
      done.show()
      if (prefs.clipOpenInEditor) openVideo(out)
    } catch (err) {
      new Notification({
        title: 'Could not save clip',
        body: err instanceof Error ? err.message : String(err)
      }).show()
    } finally {
      await rm(list, { force: true }).catch(() => undefined)
    }
  })().finally(() => {
    saving = false
  })
}

/** Leftovers from a crashed previous run. Call once at startup before the buffer starts. */
export async function sweepReplayTemp(): Promise<void> {
  const dir = ringDir()
  const names = await readdir(dir).catch(() => [] as string[])
  await Promise.all(names.map((n) => rm(join(dir, n), { force: true }).catch(() => undefined)))
}
