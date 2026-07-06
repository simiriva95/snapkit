import { BrowserWindow, type Rectangle } from 'electron'

/**
 * CleanShot-style capture feedback: a click-through white flash over the
 * captured region, fading out in ~250ms. Self-destroys.
 */
export function flashRegion(bounds: Rectangle): void {
  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: { sandbox: true }
  })
  win.setIgnoreMouseEvents(true)
  win.setAlwaysOnTop(true, 'screen-saver')

  const html =
    '<body style="margin:0;background:#fff;animation:f .25s ease-out forwards">' +
    '<style>@keyframes f{from{opacity:.85}to{opacity:0}}</style></body>'
  void win.loadURL(`data:text/html,${encodeURIComponent(html)}`)
  win.once('ready-to-show', () => win.showInactive())

  setTimeout(() => {
    if (!win.isDestroyed()) win.destroy()
  }, 320)
}
