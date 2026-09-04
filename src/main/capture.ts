import {
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  screen,
  shell,
  systemPreferences,
  type Display,
  type NativeImage,
  type Rectangle
} from 'electron'
import { getPrefs } from './prefs'
import {
  IpcChannels,
  type CaptureMode,
  type CapturePayload,
  type Rect,
  type ScrollFramesPayload,
  type WindowSource
} from '@shared/ipc'
import { createOverlay } from './overlay'
import { createWindowPicker } from './windowPicker'
import { createControlBar, sendControlStatus } from './controlbar'
import { startRecording } from './recorder'
import { flashRegion } from './flash'

/** Window the capture result is delivered to (the editor / main window). */
export interface EditorHost {
  /** Current window, if any — must NOT create one. */
  peek: () => BrowserWindow | null
  /** Get-or-create the window. */
  ensure: () => BrowserWindow
}

interface DisplayEntry {
  image: NativeImage
  /** DIP size of the captured display, to map selection → image pixels. */
  displaySize: { width: number; height: number }
  /** Absolute bounds of the captured display (for the flash effect). */
  displayBounds: Rectangle
  overlay: BrowserWindow
}

/** What the area selection is FOR: plain capture, scroll session, recording. */
type SelectionPurpose = 'capture' | 'scroll' | 'record'

/** One frozen overlay per display; the first selection wins. */
interface AreaSession {
  /** Keyed by the overlay's webContents id (correlates IPC sender → display). */
  entries: Map<number, DisplayEntry>
  /** Whether the main window was visible before capture (restore on cancel). */
  restoreMain: boolean
  /** True while we are tearing the overlays down ourselves. */
  closing: boolean
  purpose: SelectionPurpose
}

interface PickerSession {
  picker: BrowserWindow
  restoreMain: boolean
  purpose: 'capture' | 'record'
}

/** A running scrolling-capture: periodic region grabs while the user scrolls. */
interface ScrollSession {
  display: Display
  rect: Rect
  frames: string[]
  lastSignature: string
  timer: NodeJS.Timeout
  control: BrowserWindow
  grabbing: boolean
}

const SCROLL_INTERVAL_MS = 700
const SCROLL_MAX_FRAMES = 40

let session: AreaSession | null = null
let pickerSession: PickerSession | null = null

let scrollSession: ScrollSession | null = null
let busy = false

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function initCapture(host: EditorHost): void {
  ipcMain.on(IpcChannels.captureStart, (_event, kind?: CaptureMode) =>
    startCapture(kind ?? 'area', host)
  )
  ipcMain.on(IpcChannels.overlaySelect, (event, rect: Rect) =>
    finishSelection(rect, host, event.sender.id)
  )
  ipcMain.on(IpcChannels.overlayCancel, () => cancelCapture(host))
  ipcMain.on(IpcChannels.pickerSelect, (_event, id: string) => void finishWindowPick(id, host))
  ipcMain.on(IpcChannels.pickerCancel, () => cancelWindowPick(host))
  ipcMain.on(IpcChannels.controlAction, (event, action: 'done' | 'cancel') => {
    // Scroll session owns its control bar; recording handles its own in recorder.ts.
    if (scrollSession && scrollSession.control.webContents.id === event.sender.id) {
      finishScrollSession(action === 'done', host)
    }
  })
}

export function startCapture(kind: CaptureMode, host: EditorHost): void {
  // FREE BUILD: trial enforcement disabled for now. To re-enable paid mode,
  // restore the guard: status 'expired' → showTrialExpiredDialog(host).
  switch (kind) {
    case 'fullscreen':
      void startFullscreenCapture(host)
      break
    case 'window':
      void startWindowCapture(host)
      break
    case 'scrolling':
      void startAreaCapture(host, 'scroll')
      break
    case 'record':
      void startAreaCapture(host, 'record')
      break
    case 'record-screen':
      void startScreenRecording(host)
      break
    case 'record-window':
      void startWindowCapture(host, 'record')
      break
    default:
      void startAreaCapture(host)
  }
}

/** Hide the main window and check permission. Returns null if capture must abort. */
async function prepare(host: EditorHost): Promise<{ restoreMain: boolean } | null> {
  const main = host.peek()
  const restoreMain = main !== null && main.isVisible()
  if (restoreMain) {
    main?.hide()
    await delay(120) // let the compositor actually remove the window
  }
  if (!(await ensureScreenPermission())) {
    if (restoreMain) main?.show()
    return null
  }
  return { restoreMain }
}

function deliver(payload: CapturePayload, host: EditorHost): void {
  // Auto-copy the raw capture so it's paste-ready immediately (and lands in
  // the clipboard history via the poller). The editor's Copy button still
  // copies the edited image.
  if (getPrefs().autoCopyOnCapture) {
    clipboard.writeImage(nativeImage.createFromDataURL(payload.dataUrl))
  }
  const editor = host.ensure()
  sendWhenReady(editor, IpcChannels.captureCaptured, payload)
  editor.show()
  editor.focus()
}

function fail(err: unknown, restoreMain: boolean, host: EditorHost): void {
  busy = false
  if (restoreMain) host.peek()?.show()
  dialog.showErrorBox(
    'Capture failed',
    `${errorMessage(err)}\n\nIf this keeps happening, please report it.`
  )
}

export async function startAreaCapture(
  host: EditorHost,
  purpose: SelectionPurpose = 'capture'
): Promise<void> {
  if (busy) return
  busy = true

  const prep = await prepare(host)
  if (!prep) {
    busy = false
    return
  }

  try {
    // One frozen overlay per display — select on whichever screen you want.
    const displays = screen.getAllDisplays()
    const maxW = Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor)))
    const maxH = Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor)))
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: maxW, height: maxH }
    })
    if (sources.length === 0) {
      throw new Error(
        'No screen sources available. On Linux/Wayland, make sure screen sharing is supported (xdg-desktop-portal).'
      )
    }

    const entries = new Map<number, DisplayEntry>()
    for (const display of displays) {
      const source =
        sources.find((s) => s.display_id === String(display.id)) ??
        (displays.length === 1 ? sources[0] : undefined)
      if (!source || source.thumbnail.isEmpty()) continue
      const image = source.thumbnail
      const previewDataUrl = `data:image/jpeg;base64,${image.toJPEG(70).toString('base64')}`
      const overlay = createOverlay(display, previewDataUrl)
      // If an overlay dies unexpectedly, don't leave the app stuck mid-capture.
      overlay.on('closed', () => {
        if (session && !session.closing) {
          teardownOverlays()
          session = null
          busy = false
        }
      })
      entries.set(overlay.webContents.id, {
        image,
        displaySize: { width: display.size.width, height: display.size.height },
        displayBounds: display.bounds,
        overlay
      })
    }
    if (entries.size === 0) {
      throw new Error(
        'The captured image is empty — the screen may be protected or permission is missing.'
      )
    }
    session = { entries, restoreMain: prep.restoreMain, closing: false, purpose }
  } catch (err) {
    fail(err, prep.restoreMain, host)
  }
}

function teardownOverlays(): void {
  if (!session) return
  session.closing = true
  for (const entry of session.entries.values()) {
    if (!entry.overlay.isDestroyed()) entry.overlay.destroy()
  }
}

export async function startFullscreenCapture(host: EditorHost): Promise<void> {
  if (busy) return
  busy = true

  const prep = await prepare(host)
  if (!prep) {
    busy = false
    return
  }

  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const image = await grabDisplay(display)
    flashRegion(display.bounds)
    busy = false
    deliver(
      { dataUrl: image.toDataURL(), width: display.size.width, height: display.size.height },
      host
    )
  } catch (err) {
    fail(err, prep.restoreMain, host)
  }
}

/** Record the display under the cursor; no selection UI. */
export async function startScreenRecording(host: EditorHost): Promise<void> {
  if (busy) return
  busy = true
  const prep = await prepare(host)
  busy = false
  if (!prep) return
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  startRecording({ source: 'screen', display })
}

export async function startWindowCapture(
  host: EditorHost,
  purpose: 'capture' | 'record' = 'capture'
): Promise<void> {
  if (busy) return
  busy = true

  const prep = await prepare(host)
  if (!prep) {
    busy = false
    return
  }

  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 320, height: 320 }
    })
    const pickable: WindowSource[] = sources
      // Hide our own windows and empty thumbnails (minimized windows).
      .filter((s) => s.name !== 'Snapkit' && !s.thumbnail.isEmpty())
      .map((s) => ({
        id: s.id,
        name: s.name,
        thumbnailDataUrl: `data:image/jpeg;base64,${s.thumbnail.toJPEG(70).toString('base64')}`
      }))
    if (pickable.length === 0) {
      throw new Error('No capturable windows found.')
    }

    const picker = createWindowPicker(pickable)
    picker.on('closed', () => {
      if (pickerSession?.picker === picker) {
        pickerSession = null
        busy = false
      }
    })
    pickerSession = { picker, restoreMain: prep.restoreMain, purpose }
  } catch (err) {
    fail(err, prep.restoreMain, host)
  }
}

async function finishWindowPick(id: string, host: EditorHost): Promise<void> {
  if (!pickerSession) return
  const { picker, purpose } = pickerSession
  pickerSession = null
  picker.destroy()
  busy = false

  if (purpose === 'record') {
    // The recorder captures the window live via its source id; the display only
    // decides where the control bar goes.
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    startRecording({ source: 'window', display, sourceId: id })
    return
  }

  try {
    // Re-grab the chosen window at high resolution.
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 4096, height: 4096 }
    })
    const source = sources.find((s) => s.id === id)
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error('That window is no longer available — it may have been closed.')
    }
    const size = source.thumbnail.getSize()
    deliver({ dataUrl: source.thumbnail.toDataURL(), width: size.width, height: size.height }, host)
  } catch (err) {
    fail(err, false, host)
  }
}

function cancelWindowPick(host: EditorHost): void {
  if (!pickerSession) return
  const { picker, restoreMain } = pickerSession
  pickerSession = null
  picker.destroy()
  busy = false
  if (restoreMain) host.peek()?.show()
}

function finishSelection(rect: Rect, host: EditorHost, senderId: number): void {
  const entry = session?.entries.get(senderId)
  if (!session || !entry) return
  const { image, displaySize, displayBounds } = entry
  const purpose = session.purpose

  // Scroll / record selections don't produce an image now — they hand the
  // region to their own session.
  if (purpose !== 'capture') {
    teardownOverlays()
    session = null
    busy = false
    const display = screen.getDisplayMatching(displayBounds)
    if (purpose === 'scroll') beginScrollSession(display, rect, host)
    else startRecording({ source: 'area', display, rect })
    return
  }

  // Selection is in display CSS px; the image may be HiDPI. Use the real
  // ratio instead of trusting scaleFactor (thumbnail size can differ).
  const imgSize = image.getSize()
  const sx = imgSize.width / displaySize.width
  const sy = imgSize.height / displaySize.height
  const crop = {
    x: Math.max(0, Math.round(rect.x * sx)),
    y: Math.max(0, Math.round(rect.y * sy)),
    width: Math.round(rect.width * sx),
    height: Math.round(rect.height * sy)
  }
  crop.width = Math.min(crop.width, imgSize.width - crop.x)
  crop.height = Math.min(crop.height, imgSize.height - crop.y)

  const payload: CapturePayload = {
    dataUrl: image.crop(crop).toDataURL(),
    width: rect.width,
    height: rect.height
  }

  teardownOverlays()
  session = null
  busy = false

  flashRegion({
    x: displayBounds.x + Math.round(rect.x),
    y: displayBounds.y + Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  })
  deliver(payload, host)
}

function cancelCapture(host: EditorHost): void {
  if (!session) return
  const { restoreMain } = session
  teardownOverlays()
  session = null
  busy = false
  if (restoreMain) host.peek()?.show()
}

/** Cheap change-detector so identical frames (no scroll yet) are dropped. */
function frameSignature(buf: Buffer): string {
  let acc = buf.length
  for (let i = 0; i < buf.length; i += 997) acc = (acc * 31 + buf[i]) | 0
  return String(acc)
}

function beginScrollSession(display: Display, rect: Rect, host: EditorHost): void {
  busy = true
  const control = createControlBar('scroll', {
    x: display.bounds.x + Math.round(rect.x),
    y: display.bounds.y + Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  })
  control.on('closed', () => {
    if (scrollSession?.control === control) {
      clearInterval(scrollSession.timer)
      scrollSession = null
      busy = false
    }
  })

  const timer = setInterval(() => void grabScrollFrame(display, rect, host), SCROLL_INTERVAL_MS)
  scrollSession = { display, rect, frames: [], lastSignature: '', timer, control, grabbing: false }
  // Grab the initial frame right away.
  void grabScrollFrame(display, rect, host)
}

async function grabScrollFrame(display: Display, rect: Rect, host: EditorHost): Promise<void> {
  const s = scrollSession
  if (!s || s.grabbing) return
  s.grabbing = true
  try {
    const image = await grabDisplay(display)
    const imgSize = image.getSize()
    const sx = imgSize.width / display.size.width
    const sy = imgSize.height / display.size.height
    const crop = {
      x: Math.max(0, Math.round(rect.x * sx)),
      y: Math.max(0, Math.round(rect.y * sy)),
      width: Math.min(Math.round(rect.width * sx), imgSize.width),
      height: Math.min(Math.round(rect.height * sy), imgSize.height)
    }
    const png = image.crop(crop).toPNG()
    const signature = frameSignature(png)
    if (signature !== s.lastSignature) {
      s.lastSignature = signature
      s.frames.push(`data:image/png;base64,${png.toString('base64')}`)
      sendControlStatus(s.control, `${s.frames.length} frame${s.frames.length === 1 ? '' : 's'}`)
      if (s.frames.length >= SCROLL_MAX_FRAMES) finishScrollSession(true, host)
    }
  } catch {
    // transient grab failure — skip this tick
  } finally {
    if (scrollSession) scrollSession.grabbing = false
  }
}

function finishScrollSession(deliverFrames: boolean, host: EditorHost): void {
  const s = scrollSession
  if (!s) return
  scrollSession = null
  clearInterval(s.timer)
  s.control.destroy()
  busy = false

  if (deliverFrames && s.frames.length > 0) {
    const payload: ScrollFramesPayload = { frames: s.frames, dipWidth: Math.round(s.rect.width) }
    const editor = host.ensure()
    sendWhenReady(editor, IpcChannels.scrollFrames, payload)
    editor.show()
    editor.focus()
  }
}

async function grabDisplay(display: Display): Promise<NativeImage> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor)
    }
  })
  if (sources.length === 0) {
    throw new Error(
      'No screen sources available. On Linux/Wayland, make sure screen sharing is supported (xdg-desktop-portal).'
    )
  }
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (source.thumbnail.isEmpty()) {
    throw new Error(
      'The captured image is empty — the screen may be protected or permission is missing.'
    )
  }
  return source.thumbnail
}

/**
 * macOS Screen Recording permission. Note the OS quirk: the app only appears
 * in the privacy pane after an attempted capture, and a grant requires an app
 * relaunch to take effect.
 */
async function ensureScreenPermission(): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  if (systemPreferences.getMediaAccessStatus('screen') === 'granted') return true

  // Register the app in the Screen Recording pane.
  await desktopCapturer
    .getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
    .catch(() => undefined)
  if (systemPreferences.getMediaAccessStatus('screen') === 'granted') return true

  const { response } = await dialog.showMessageBox({
    type: 'warning',
    message: 'Screen Recording permission needed',
    detail:
      'Snapkit captures your screen locally — nothing ever leaves this device.\n\n' +
      'Grant access in System Settings → Privacy & Security → Screen Recording, ' +
      'then quit and reopen Snapkit (macOS requires a relaunch after granting).',
    buttons: ['Open System Settings', 'Cancel'],
    defaultId: 0,
    cancelId: 1
  })
  if (response === 0) {
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    )
  }
  return false
}

function sendWhenReady(win: BrowserWindow, channel: string, payload: unknown): void {
  const wc = win.webContents
  if (wc.isLoading()) {
    wc.once('did-finish-load', () => wc.send(channel, payload))
  } else {
    wc.send(channel, payload)
  }
}
