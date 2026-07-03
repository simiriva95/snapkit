import {
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  screen,
  shell,
  systemPreferences,
  type Display,
  type NativeImage
} from 'electron'
import { IpcChannels, type CapturePayload, type Rect } from '@shared/ipc'
import { createOverlay } from './overlay'

/** Window the capture result is delivered to (the editor / main window). */
export interface EditorHost {
  /** Current window, if any — must NOT create one. */
  peek: () => BrowserWindow | null
  /** Get-or-create the window. */
  ensure: () => BrowserWindow
}

interface Session {
  image: NativeImage
  /** DIP size of the captured display, to map selection → image pixels. */
  displaySize: { width: number; height: number }
  overlay: BrowserWindow
  /** Whether the main window was visible before capture (restore on cancel). */
  restoreMain: boolean
}

let session: Session | null = null
let busy = false

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function initCapture(host: EditorHost): void {
  ipcMain.on(IpcChannels.captureStart, () => void startAreaCapture(host))
  ipcMain.on(IpcChannels.overlaySelect, (_event, rect: Rect) => finishSelection(rect, host))
  ipcMain.on(IpcChannels.overlayCancel, () => cancelCapture(host))
}

export async function startAreaCapture(host: EditorHost): Promise<void> {
  if (busy) return
  busy = true

  const main = host.peek()
  const restoreMain = main !== null && main.isVisible()
  if (restoreMain) {
    main.hide()
    await delay(120) // let the compositor actually remove the window
  }

  try {
    if (!(await ensureScreenPermission())) {
      if (restoreMain) main.show()
      busy = false
      return
    }

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
      overlay,
      restoreMain
    }
  } catch (err) {
    busy = false
    if (restoreMain) main.show()
    dialog.showErrorBox(
      'Capture failed',
      `${errorMessage(err)}\n\nIf this keeps happening, please report it.`
    )
  }
}

function finishSelection(rect: Rect, host: EditorHost): void {
  if (!session) return
  const { image, displaySize, overlay } = session

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

  const editor = host.ensure()
  sendWhenReady(editor, IpcChannels.captureCaptured, payload)
  editor.show()
  editor.focus()
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
