import { app, BrowserWindow, ipcMain, Notification, powerMonitor, screen, shell } from 'electron'
import { mkdir, readdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { IpcChannels, type ReplayJob } from '@shared/ipc'
import type { Prefs } from '@shared/prefs'
import type { RecordFormat } from '@shared/recordPlan'
import {
  clipFileName,
  clipSegments,
  concatListText,
  ringTrim,
  SEGMENT_SEC,
  type Segment
} from '@shared/replayPlan'
import { concatArgs } from '@shared/videoArgs'
import { ensureScreenPermission } from './capture'
import { runFfmpeg } from './ffmpeg'
import { getPrefs } from './prefs'
import { APP_URL } from './protocol'
import { clearPendingSource, setPendingSource, systemAudioSupported } from './recorder'
import { openVideo } from './video'

/**
 * Replay buffer ("save the last N seconds"). A hidden replay.html window
 * records the display under the cursor in 10 s segments; main keeps the newest
 * ones on disk (see replayPlan.ringTrim) and, on the hotkey, flushes the
 * in-progress segment and stream-copies whole segments into a clip with ffmpeg
 * (never seeking inside a segment — MediaRecorder output has one keyframe per
 * segment).
 */

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']
const FLUSH_TIMEOUT_MS = 5_000
/** Restart back-off after a failure; after the last step the buffer gives up. */
const RESTART_DELAYS_MS = [1_500, 5_000, 15_000, 30_000, 60_000]

interface RingBuffer {
  win: BrowserWindow
  dir: string
  segments: Segment[]
  keepMs: number
  seq: number
  ext: RecordFormat | null
  stopping: boolean
  /** Recording settings the buffer was started with; a change restarts it. */
  jobKey: string
}

let buffer: RingBuffer | null = null
let starting = false
let saving = false
/** A restart requested while a save was running; honoured when the save ends. */
let restartAfterSave = false
let flushSeq = 0
let pendingFlush: { id: number; resolve: () => void } | null = null
let failures = 0
let restartTimer: NodeJS.Timeout | null = null
const listeners = new Set<(running: boolean) => void>()

export function isReplayRunning(): boolean {
  return buffer !== null
}
export function onReplayStateChange(cb: (running: boolean) => void): void {
  listeners.add(cb)
}
const emit = (): void => listeners.forEach((cb) => cb(buffer !== null))

// Per process: a dev instance and the packaged app must not share (and sweep) one ring.
const ringDir = (): string => join(app.getPath('temp'), `snapkit-replay-${process.pid}`)
const clipsDir = (prefs: Prefs): string =>
  prefs.clipsDir ?? join(app.getPath('videos'), 'Snapkit Clips')
const jobKeyOf = (p: Prefs): string =>
  `${p.recordResolution}/${p.recordFps}/${p.recordSystemAudio}/${p.recordMic}`
const notify = (title: string, body?: string): void => {
  new Notification({ title, body, silent: true }).show()
}

export function initReplay(): void {
  ipcMain.on(
    IpcChannels.replaySegment,
    (event, data: ArrayBuffer, durationMs: number, ext: RecordFormat, flushId?: number) => {
      if (!buffer || event.sender.id !== buffer.win.webContents.id) return
      if (ext !== 'mp4' && ext !== 'webm') {
        if (flushId !== undefined && pendingFlush?.id === flushId) {
          pendingFlush.resolve()
          pendingFlush = null
        }
        return
      }
      void storeSegment(
        buffer,
        Buffer.from(data),
        Math.max(0, Number(durationMs) || 0),
        ext
      ).finally(() => {
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
    restartLater()
  })
  // The stream dies across sleep and display changes; the renderer notices too,
  // but restarting explicitly keeps the buffer alive without waiting for it.
  powerMonitor.on('resume', restartLater)
  screen.on('display-removed', restartLater)
  applyReplayPrefs(getPrefs())
}

/** Start, stop, resize or restart the buffer to match the prefs. Idempotent. */
export function applyReplayPrefs(prefs: Prefs): void {
  const keepMs = prefs.replayBuffer * 1000
  if (keepMs === 0) {
    if (buffer) void stopBuffer()
    return
  }
  failures = 0 // a deliberate change gets a fresh set of attempts
  if (buffer) {
    if (buffer.jobKey !== jobKeyOf(prefs)) {
      // Resolution / fps / audio changed: the stream must be re-acquired.
      void stopBuffer().then(() => startBuffer(keepMs))
      return
    }
    buffer.keepMs = keepMs
    void trimRing(buffer)
    return
  }
  void startBuffer(keepMs)
}

/** Quit path: release the stream and the ring without a restart. */
export async function stopReplay(): Promise<void> {
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = null
  await stopBuffer()
}

async function startBuffer(keepMs: number): Promise<void> {
  if (buffer || starting) return
  starting = true
  try {
    if (!(await ensureScreenPermission())) {
      notify(
        'Replay buffer needs Screen Recording access',
        'Grant it, then turn the buffer on again.'
      )
      return
    }
    const dir = ringDir()
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    await mkdir(dir, { recursive: true })
    // Re-read after the awaits: the pref may have been switched off meanwhile.
    const prefs = getPrefs()
    if (buffer || prefs.replayBuffer === 0) return
    keepMs = prefs.replayBuffer * 1000 // the length may have changed during the awaits

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const systemAudio = prefs.recordSystemAudio && systemAudioSupported()
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
    setPendingSource(win.webContents.id, { displayId: display.id, audio: systemAudio })

    const job: ReplayJob = {
      displaySize: { width: display.size.width, height: display.size.height },
      resolution: prefs.recordResolution,
      fps: prefs.recordFps,
      // A background buffer must never pop the macOS microphone prompt (e.g. at login).
      mic: prefs.recordMic && process.platform !== 'darwin',
      systemAudio,
      segmentSec: SEGMENT_SEC
    }
    win.webContents.once('did-finish-load', () =>
      win.webContents.send(IpcChannels.replayStart, job)
    )
    win.webContents.once('did-fail-load', () => {
      console.warn('[replay] window failed to load')
      restartLater()
    })
    void win.loadURL(
      RENDERER_DEV_URL ? `${RENDERER_DEV_URL}/replay.html` : `${APP_URL}/replay.html`
    )

    const onDied = (): void => {
      if (buffer?.win === win && !buffer.stopping) {
        buffer = null
        emit()
        if (!win.isDestroyed()) {
          clearPendingSource(win.webContents.id)
          win.destroy() // render-process-gone leaves the window object alive
        }
        restartLater()
      }
    }
    win.on('closed', onDied)
    win.webContents.on('render-process-gone', onDied)

    buffer = {
      win,
      dir,
      segments: [],
      keepMs,
      seq: 0,
      ext: null,
      stopping: false,
      jobKey: jobKeyOf(prefs)
    }
    emit()
  } finally {
    starting = false
  }
}

async function stopBuffer(): Promise<void> {
  const b = buffer
  if (!b) return
  b.stopping = true
  buffer = null
  emit()
  if (!b.win.isDestroyed()) {
    clearPendingSource(b.win.webContents.id)
    b.win.webContents.send(IpcChannels.replayStop)
    // Give the renderer a moment to release the stream, then drop the window.
    setTimeout(() => {
      if (!b.win.isDestroyed()) b.win.destroy()
    }, 2_000)
  }
  await rm(b.dir, { recursive: true, force: true }).catch(() => undefined)
}

/**
 * Restart after a failure with back-off; give up (one notification) when the
 * failure persists. Reset by a stored segment or a pref change.
 */
function restartLater(): void {
  if (restartTimer) return
  if (saving) {
    restartAfterSave = true
    return
  }
  const delay = RESTART_DELAYS_MS[failures]
  if (delay === undefined) {
    void stopBuffer()
    notify(
      'Replay buffer stopped',
      'Screen capture kept failing. Turn the buffer off and on again in Preferences to retry.'
    )
    failures = 0
    return
  }
  failures++
  restartTimer = setTimeout(() => {
    restartTimer = null
    const prefs = getPrefs()
    if (prefs.replayBuffer === 0) return
    void (buffer ? stopBuffer() : Promise.resolve()).then(() =>
      startBuffer(prefs.replayBuffer * 1000)
    )
  }, delay)
}

async function storeSegment(
  b: RingBuffer,
  bytes: Buffer,
  durationMs: number,
  ext: RecordFormat
): Promise<void> {
  if (bytes.byteLength === 0) return
  failures = 0 // the capture works
  b.ext = ext
  const path = join(b.dir, `seg-${String(b.seq++).padStart(6, '0')}.${ext}`)
  try {
    await writeFile(path, bytes)
  } catch (err) {
    // Disk full or temp dir gone: stop rather than loop on failures.
    notify('Replay buffer stopped', err instanceof Error ? err.message : String(err))
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

/**
 * The hotkey: flush, concat whole segments covering the window, save, notify.
 * No on-screen feedback before the flush — the buffer is recording this very
 * display, so a flash or banner would end up inside the clip.
 */
export function saveReplay(): void {
  const b = buffer
  if (!b) {
    notify('Replay buffer is off', 'Turn it on in Preferences to save clips.')
    return
  }
  if (saving) return
  saving = true
  void (async () => {
    const prefs = getPrefs()
    await flush(b)
    if (b.segments.length === 0 || !b.ext) {
      notify('Nothing to save yet', 'The replay buffer is still warming up.')
      return
    }
    const segments = clipSegments(b.segments, b.keepMs)
    const totalMs = segments.reduce((acc, s) => acc + s.durationMs, 0)
    const list = join(b.dir, `clip-${Date.now()}.txt`)
    const dir = clipsDir(prefs)
    const out = join(dir, clipFileName(new Date(), b.ext))
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(list, concatListText(segments.map((s) => s.path)))
      await runFfmpeg({ args: concatArgs(list, out), durationSec: Math.max(0.1, totalMs / 1000) })
      const done = new Notification({ title: 'Clip saved', body: out, silent: true })
      done.on('click', () => shell.showItemInFolder(out))
      done.show()
      if (prefs.clipOpenInEditor) openVideo(out)
    } catch (err) {
      notify('Could not save clip', err instanceof Error ? err.message : String(err))
    } finally {
      await rm(list, { force: true }).catch(() => undefined)
    }
  })().finally(() => {
    saving = false
    if (restartAfterSave) {
      restartAfterSave = false
      restartLater()
    }
  })
}

/** Leftovers from crashed previous runs (any pid). Call once at startup before the buffer starts. */
export async function sweepReplayTemp(): Promise<void> {
  const tmp = app.getPath('temp')
  const names = await readdir(tmp).catch(() => [] as string[])
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  await Promise.all(
    names
      .filter((n) => n.startsWith('snapkit-replay'))
      // Another Snapkit (dev instance beside the packaged app) may own a live ring: leave it.
      .filter((n) => {
        const pid = Number(n.slice('snapkit-replay-'.length))
        return !(Number.isInteger(pid) && pid > 0 && pid !== process.pid && alive(pid))
      })
      .filter((n) => n !== `snapkit-replay-${process.pid}`)
      .map((n) => rm(join(tmp, n), { recursive: true, force: true }).catch(() => undefined))
  )
}
