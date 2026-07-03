import { app, clipboard, dialog, ipcMain, nativeImage, BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { IpcChannels, type ExportSaveResult } from '@shared/ipc'
import { getPrefs } from './prefs'

const pad = (n: number): string => String(n).padStart(2, '0')

function defaultFileName(ext: string): string {
  const d = new Date()
  return `Snapkit ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} at ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}.${ext}`
}

export function registerExportIpc(): void {
  ipcMain.handle(
    IpcChannels.exportSave,
    async (event, dataUrl: string): Promise<ExportSaveResult> => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender)
        const prefs = getPrefs()
        const dir = prefs.exportDir ?? app.getPath('desktop')
        const png = { name: 'PNG image', extensions: ['png'] }
        const jpg = { name: 'JPEG image', extensions: ['jpg', 'jpeg'] }
        const options = {
          defaultPath: join(dir, defaultFileName(prefs.exportFormat)),
          // preferred format first — drives the dialog's preselected type
          filters: prefs.exportFormat === 'jpg' ? [jpg, png] : [png, jpg]
        }
        const { canceled, filePath } = win
          ? await dialog.showSaveDialog(win, options)
          : await dialog.showSaveDialog(options)
        if (canceled || !filePath) return { status: 'canceled' }

        const image = nativeImage.createFromDataURL(dataUrl)
        const isJpeg = /\.jpe?g$/i.test(filePath)
        await writeFile(filePath, isJpeg ? image.toJPEG(90) : image.toPNG())
        return { status: 'saved', path: filePath }
      } catch (err) {
        return {
          status: 'error',
          message: err instanceof Error ? err.message : String(err)
        }
      }
    }
  )

  ipcMain.handle(IpcChannels.exportCopy, (_event, dataUrl: string) => {
    clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
  })
}
