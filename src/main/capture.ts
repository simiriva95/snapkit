import {
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  screen,
  shell,
  systemPreferences,
  type Display,
  type NativeImage,
  type Rectangle
} from 'electron'
import {
  IpcChannels,
  type CaptureMode,
  type CapturePayload,
  type Rect,
  type WindowSource
} from '@shared/ipc'
import { createOverlay } from './overlay'
import { createWindowPicker } from './windowPicker'
import { flashRegion } from './flash'
import { licenseValidator } from './license'

/** Window the capture result is delivered to (the editor / main window). */
export interface EditorHost {
  /** Current window, if any — must NOT create one. */
  peek: () => BrowserWindow | null
  /** Get-or-create the window. */
  ensure: () => BrowserWindow
}

interface AreaSession {
  image: NativeImage
  /** DIP size of the captured display, to map selection → image pixels. */
  displaySize: { width: number; height: number }
  /** Absolute bounds of the captured display (for the flash effect). */
  displayBounds: Rectangle
  overlay: BrowserWindow
  /** Whether the main window was visible before capture (restore on cancel). */
  restoreMain: boolean
}

interface PickerSession {
  picker: BrowserWindow
  restoreMain: boolean
}

let session: AreaSession | null = null
let pickerSession: PickerSession | null = null
let busy = false

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function initCapture(host: EditorHost): void {
  ipcMain.on(IpcChannels.captureStart, (_event, kind?: CaptureMode) =>
    startCapture(kind ?? 'area', host)
  )
  ipcMain.on(IpcChannels.overlaySelect, (_event, rect: Rect) => finishSelection(rect, host))
  ipcMain.on(IpcChannels.overlayCancel, () => cancelCapture(host))
  ipcMain.on(IpcChannels.pickerSelect, (_event, id: string) => void finishWindowPick(id, host))
  ipcMain.on(IpcChannels.pickerCancel, () => cancelWindowPick(host))
}

export function startCapture(kind: CaptureMode, host: EditorHost): void {
  // Trial enforcement is soft: new captures are blocked, the editor and
  // export of already-captured shots keep working.
  if (licenseValidator.status().kind === 'expired') {
    showTrialExpiredDialog(host)
    return
  }
  switch (kind) {
    case 'fullscreen':
      void startFullscreenCapture(host)
      break
    case 'window':
      void startWindowCapture(host)
      break
    default:
      void startAreaCapture(host)
  }
}

function showTrialExpiredDialog(host: EditorHost): void {
  void dialog
    .showMessageBox({
      type: 'info',
      message: 'Your Snapkit trial has ended',
      detail:
        'Enter a license key in Preferences to keep capturing. ' +
        'Everything stays offline — the key is validated on this device.',
      buttons: ['Open Snapkit', 'Cancel'],
      defaultId: 0,
      cancelId: 1
    })
    .then(({ response }) => {
      if (response === 0) {
        const win = host.ensure()
        win.show()
        win.focus()
      }
    })
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

export async function startAreaCapture(host: EditorHost): Promise<void> {
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
    const previewDataUrl = `data:image/jpeg;base64,${image.toJPEG(70).toString('base64')}`
    const overlay = createOverlay(display, previewDataUrl)
    // If the overlay dies for any reason, don't leave the app stuck mid-capture.
    overlay.on('closed', () => {
      if (session?.overlay === overlay) {
        session = null
        busy = false
      }
    })
    session = {
      image,
      displaySize: { width: display.size.width, height: display.size.height },
      displayBounds: display.bounds,
      overlay,
      restoreMain: prep.restoreMain
    }
  } catch (err) {
    fail(err, prep.restoreMain, host)
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

export async function startWindowCapture(host: EditorHost): Promise<void> {
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
    pickerSession = { picker, restoreMain: prep.restoreMain }
  } catch (err) {
    fail(err, prep.restoreMain, host)
  }
}

async function finishWindowPick(id: string, host: EditorHost): Promise<void> {
  if (!pickerSession) return
  const { picker } = pickerSession
  pickerSession = null
  picker.destroy()
  busy = false

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

function finishSelection(rect: Rect, host: EditorHost): void {
  if (!session) return
  const { image, displaySize, displayBounds, overlay } = session

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

  session = null
  overlay.destroy()
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
  const { overlay, restoreMain } = session
  session = null
  overlay.destroy()
  busy = false
  if (restoreMain) host.peek()?.show()
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
