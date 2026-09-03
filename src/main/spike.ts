// src/main/spike.ts — TEMPORARY (video suite V0). Deleted after results land in the spec.
import { BrowserWindow, desktopCapturer, session } from 'electron'
import { execFile } from 'child_process'
import { ffmpegPath } from './ffmpeg'

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']

export function initSpike(): void {
  if (!process.env['SNAPKIT_SPIKE']) return

  // Check 4: does the bundled binary spawn (dev AND packaged)?
  execFile(ffmpegPath(), ['-version'], (err, stdout) => {
    console.log('[spike] ffmpeg path:', ffmpegPath())
    console.log('[spike] ffmpeg:', err ? `ERROR ${err.message}` : stdout.split('\n')[0])
  })

  if (!RENDERER_DEV_URL) return // packaged run: checks 1–3 are renderer-only, skip

  // Check 2: ask Chromium for system audio alongside the screen.
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
      .catch(() => callback({}))
  })

  const win = new BrowserWindow({ width: 900, height: 700, title: 'Snapkit spike' })
  win.webContents.on('console-message', (details) => {
    console.log('[spike:renderer]', details.message)
  })
  void win.loadURL(`${RENDERER_DEV_URL}/spike.html`)
}
