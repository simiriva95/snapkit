import { app, dialog, net } from 'electron'
import { autoUpdater } from 'electron-updater'
import { spawn } from 'child_process'
import { createWriteStream } from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

const REPO = 'simiriva95/snapkit'
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

/**
 * Auto-update via GitHub Releases (publish config in electron-builder.yml).
 * Only meaningful in packaged builds; check failures are logged, never
 * surfaced — an unreachable update server must not degrade the app.
 *
 * macOS: Squirrel.Mac refuses updates for un-notarized (ad-hoc signed)
 * builds, so electron-updater can't apply them. We do it ourselves instead:
 * download the release zip (app-downloaded files carry no quarantine),
 * swap the bundle, relaunch. Drop this path once we notarize.
 */
export function initAutoUpdate(): void {
  if (!app.isPackaged) return
  if (process.platform === 'darwin') {
    void checkMacUpdate()
    setInterval(() => void checkMacUpdate(), CHECK_EVERY_MS)
    return
  }
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.warn('[updater] update check failed:', err instanceof Error ? err.message : err)
  })
}

/** Strict x.y.z compare — true when `a` is newer than `b`. */
export function newerThan(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true
    if ((pa[i] || 0) < (pb[i] || 0)) return false
  }
  return false
}

let updating = false

async function checkMacUpdate(): Promise<void> {
  if (updating) return
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
    if (!res.ok) return
    const rel = (await res.json()) as {
      tag_name: string
      assets: { name: string; browser_download_url: string }[]
    }
    const latest = rel.tag_name.replace(/^v/, '')
    if (!newerThan(latest, app.getVersion())) return
    const asset = rel.assets.find((a) => a.name.endsWith('arm64-mac.zip'))
    if (!asset) return

    const { response } = await dialog.showMessageBox({
      type: 'info',
      message: `Snapkit ${latest} is available`,
      detail: `You are on ${app.getVersion()}. Install now? Snapkit restarts automatically.`,
      buttons: ['Install & Restart', 'Later'],
      defaultId: 0,
      cancelId: 1
    })
    if (response !== 0) return

    updating = true
    try {
      await installMacUpdate(asset.browser_download_url)
    } catch (err) {
      updating = false
      dialog.showErrorBox(
        'Update failed',
        `${err instanceof Error ? err.message : err}\n\nYou can update manually: see the install instructions on GitHub.`
      )
    }
  } catch (err) {
    console.warn('[updater] update check failed:', err instanceof Error ? err.message : err)
  }
}

async function installMacUpdate(url: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'snapkit-update-'))
  try {
    const zip = join(dir, 'update.zip')
    const res = await net.fetch(url)
    if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`)
    // DOM vs node:stream/web ReadableStream types disagree; runtime is fine.
    await pipeline(
      Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream),
      createWriteStream(zip)
    )

    // ditto preserves the code signature; unzip can corrupt it.
    await run('ditto', ['-xk', zip, dir])
    const next = join(dir, 'Snapkit.app')

    // .../Snapkit.app/Contents/MacOS/Snapkit → .../Snapkit.app
    const current = resolve(app.getPath('exe'), '..', '..', '..')
    if (!current.endsWith('.app')) throw new Error(`Unexpected bundle path: ${current}`)

    // Safe while running: open files live on by inode.
    await rm(current, { recursive: true, force: true })
    await run('ditto', [next, current])

    app.relaunch()
    app.exit(0)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: 'ignore' })
    p.on('error', rej)
    p.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited with ${code}`))))
  })
}
