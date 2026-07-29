import { app, BrowserWindow, clipboard, ipcMain, nativeImage, screen } from 'electron'
import { exec } from 'child_process'
import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, unlink } from 'fs'
import { IpcChannels, type HistoryEntry } from '@shared/ipc'
import { getPrefs } from './prefs'
import { ocrImage } from './ocrIndex'
import { APP_URL } from './protocol'

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']

const MAX_ENTRIES = 50
const POLL_MS = 1000
const THUMB_WIDTH = 240

/** Internal record. Images live on disk; only the thumbnail is kept inline. */
interface Entry {
  id: string
  type: 'text' | 'image'
  text?: string
  /** image entries: absolute PNG path. */
  file?: string
  thumbDataUrl?: string
  /** image entries: content hash, for dedup. */
  sig?: string
  /** image entries: OCR'd text, so search can match screenshot content. */
  ocrText?: string
  ts: number
  pinned: boolean
}

let entries: Entry[] = []
let lastText = ''
let lastImageSig = ''
let timer: NodeJS.Timeout | null = null
let seq = 0
let panel: BrowserWindow | null = null

const dir = (): string => join(app.getPath('userData'), 'history')
const manifestPath = (): string => join(dir(), 'manifest.json')

/** Cheap content hash — samples the buffer, good enough to spot changes. */
function sig(buf: Buffer): string {
  let acc = buf.length
  for (let i = 0; i < buf.length; i += 1009) acc = (acc * 31 + buf[i]) | 0
  return String(acc)
}

function nextId(): string {
  return `${Date.now()}-${seq++}`
}

function toPublic(e: Entry): HistoryEntry {
  return {
    id: e.id,
    type: e.type,
    text: e.text,
    thumbDataUrl: e.thumbDataUrl,
    ts: e.ts,
    pinned: e.pinned,
    ocrText: e.ocrText
  }
}

/** Fire-and-forget OCR for one image entry; stores the text when ready. */
function indexImage(id: string, dataUrl: string): void {
  void ocrImage(dataUrl, getPrefs().ocrLanguages).then((text) => {
    const e = entries.find((x) => x.id === id)
    if (!e) return
    // Store even '' — it marks the image as indexed so we don't re-OCR it.
    e.ocrText = text
    persist()
    if (text) broadcast()
  })
}

/** Pinned first, then most-recent. sort is stable, so recency order is kept. */
function ordered(): Entry[] {
  return [...entries].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
}

function persist(): void {
  try {
    mkdirSync(dir(), { recursive: true })
    writeFileSync(manifestPath(), JSON.stringify(entries))
  } catch {
    // history persistence is best-effort; never crash the app over it
  }
}

function broadcast(): void {
  if (panel && !panel.isDestroyed()) panel.webContents.send(IpcChannels.historyChanged)
}

/** Drop oldest un-pinned entries until within cap. */
function evict(): void {
  for (let i = entries.length - 1; i >= 0 && entries.length > MAX_ENTRIES; i--) {
    if (!entries[i].pinned) {
      const [dropped] = entries.splice(i, 1)
      if (dropped.file) unlink(dropped.file, () => {})
    }
  }
}

/** Add a new entry, or resurface an existing identical one to the top (MRU). */
function addOrSurface(make: () => Entry, matches: (x: Entry) => boolean): void {
  const existing = entries.find(matches)
  if (existing) {
    entries = entries.filter((e) => e !== existing)
    existing.ts = Date.now()
    entries.unshift(existing)
  } else {
    let e: Entry
    try {
      e = make()
    } catch {
      return // disk write failed — skip this item rather than crash the poller
    }
    entries.unshift(e)
    evict()
  }
  persist()
  broadcast()
}

function poll(): void {
  const text = clipboard.readText()
  if (text && text !== lastText) {
    lastText = text
    addOrSurface(
      () => ({ id: nextId(), type: 'text', text, ts: Date.now(), pinned: false }),
      (x) => x.type === 'text' && x.text === text
    )
    return
  }
  // ponytail: text wins when both are present (rich copy) — images-only path
  // covers screenshots, which is the case that matters here.
  const img = clipboard.readImage()
  if (img.isEmpty()) return
  const png = img.toPNG()
  const s = sig(png)
  if (s === lastImageSig) return
  lastImageSig = s

  addOrSurface(
    () => {
      const id = nextId()
      const file = join(dir(), `${id}.png`)
      mkdirSync(dir(), { recursive: true })
      writeFileSync(file, png)
      indexImage(id, `data:image/png;base64,${png.toString('base64')}`)
      return {
        id,
        type: 'image',
        file,
        sig: s,
        thumbDataUrl: img.resize({ width: THUMB_WIDTH }).toDataURL(),
        ts: Date.now(),
        pinned: false
      }
    },
    (x) => x.type === 'image' && x.sig === s
  )
}

function copyEntry(id: string): void {
  const e = entries.find((x) => x.id === id)
  if (!e) return
  if (e.type === 'text' && e.text != null) {
    clipboard.writeText(e.text)
    lastText = e.text
  } else if (e.file) {
    const img = nativeImage.createFromPath(e.file)
    if (img.isEmpty()) return
    clipboard.writeImage(img)
    lastImageSig = sig(img.toPNG())
  }
  // MRU: most-recently-used bubbles to the top.
  entries = entries.filter((x) => x !== e)
  e.ts = Date.now()
  entries.unshift(e)
  persist()
  if (getPrefs().autoPaste) schedulePaste()
}

/**
 * Send a paste keystroke to whatever app regains focus once our panel closes.
 * Needs OS accessibility permission (macOS prompts on first use). Linux is
 * skipped — it would need xdotool, which isn't guaranteed to be installed.
 * ponytail: fixed 180ms settle; if paste lands before refocus, bump it.
 */
function schedulePaste(): void {
  const cmd =
    process.platform === 'darwin'
      ? `osascript -e 'tell application "System Events" to keystroke "v" using command down'`
      : process.platform === 'win32'
        ? `powershell -c "Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait('^v')"`
        : null
  if (!cmd) return
  setTimeout(() => exec(cmd, () => {}), 180)
}

function pin(id: string): void {
  const e = entries.find((x) => x.id === id)
  if (!e) return
  e.pinned = !e.pinned
  persist()
  broadcast()
}

function remove(id: string): void {
  const e = entries.find((x) => x.id === id)
  if (!e) return
  entries = entries.filter((x) => x !== e)
  if (e.file) unlink(e.file, () => {})
  persist()
  broadcast()
}

function clear(): void {
  // Keep pinned entries — Clear wipes the disposable history only.
  for (const e of entries) if (!e.pinned && e.file) unlink(e.file, () => {})
  entries = entries.filter((e) => e.pinned)
  persist()
  broadcast()
}

function startPolling(): void {
  if (timer) return
  // Seed baselines from the current clipboard so we don't re-add what's
  // already there at launch.
  lastText = clipboard.readText()
  const img = clipboard.readImage()
  lastImageSig = img.isEmpty() ? '' : sig(img.toPNG())
  timer = setInterval(poll, POLL_MS)
}

function stopPolling(): void {
  if (timer) clearInterval(timer)
  timer = null
}

export function openHistoryPanel(): void {
  if (panel && !panel.isDestroyed()) {
    app.focus({ steal: true })
    panel.show()
    panel.focus()
    return
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = 640
  const height = 480
  panel = new BrowserWindow({
    x: display.bounds.x + Math.round((display.bounds.width - width) / 2),
    y: display.bounds.y + Math.round((display.bounds.height - height) / 2),
    width,
    height,
    frame: false,
    show: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  // Behave like the OS clipboard popup: float above everything (fullscreen
  // apps included) and show on whatever Space the user is on.
  panel.setAlwaysOnTop(true, 'pop-up-menu')
  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  panel.on('closed', () => {
    panel = null
  })
  // Dismiss when it loses focus, like the OS clipboard popup.
  panel.on('blur', () => panel?.close())
  panel.webContents.once('did-finish-load', () => {
    // macOS refuses focus to background apps unless stolen explicitly —
    // without this the panel appears unfocused (no typing) or seems missing.
    app.focus({ steal: true })
    panel?.show()
    panel?.focus()
  })
  void panel.loadURL(
    RENDERER_DEV_URL ? `${RENDERER_DEV_URL}/history.html` : `${APP_URL}/history.html`
  )
}

function closePanel(): void {
  if (panel && !panel.isDestroyed()) panel.close()
}

/** Load persisted history, wire IPC, and start polling if enabled. */
export function initHistory(): void {
  try {
    const loaded = JSON.parse(readFileSync(manifestPath(), 'utf8')) as Entry[]
    // Migrate manifests written before `pinned` existed.
    entries = loaded.map((e) => ({ ...e, pinned: e.pinned ?? false }))
  } catch {
    entries = []
  }

  // Backfill OCR for images saved before indexing existed (or that never finished).
  if (getPrefs().clipboardHistory) {
    for (const e of entries) {
      if (e.type !== 'image' || e.ocrText != null || !e.file) continue
      try {
        indexImage(e.id, `data:image/png;base64,${readFileSync(e.file).toString('base64')}`)
      } catch {
        // file gone — nothing to index
      }
    }
  }

  ipcMain.handle(IpcChannels.historyList, () => ordered().map(toPublic))
  ipcMain.on(IpcChannels.historyCopy, (_e, id: string) => {
    copyEntry(id)
    closePanel()
  })
  ipcMain.on(IpcChannels.historyPin, (_e, id: string) => pin(id))
  ipcMain.on(IpcChannels.historyDelete, (_e, id: string) => remove(id))
  ipcMain.on(IpcChannels.historyClear, () => clear())
  ipcMain.on(IpcChannels.historyCancel, () => closePanel())

  if (getPrefs().clipboardHistory) startPolling()
}

/** React to a prefs change: enable/disable the clipboard poller. */
export function applyHistoryPrefs(clipboardHistory: boolean): void {
  if (clipboardHistory) startPolling()
  else stopPolling()
}

export function stopHistory(): void {
  stopPolling()
}
