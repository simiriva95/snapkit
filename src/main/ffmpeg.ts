import { app } from 'electron'
import { spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { rename, rm } from 'fs/promises'
import { join, parse } from 'path'

/**
 * Bundled ffmpeg: the ONLY way the app touches video files after capture
 * (trim / concat / transcode / gif). Never used to capture the screen —
 * that stays on getDisplayMedia + MediaRecorder (see the video suite spec).
 *
 * output is written to a sibling temp file and renamed into place on
 * success, so a failed or aborted run never touches a pre-existing
 * destination.
 */

// Folder names follow electron-builder's ${os} macro (see electron-builder.yml).
const OS: Record<string, string> = { darwin: 'mac', win32: 'win', linux: 'linux' }
const BIN = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'

export function ffmpegPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'ffmpeg', BIN)
    : join(
        app.getAppPath(),
        'resources',
        'ffmpeg',
        `${OS[process.platform] ?? process.platform}-${process.arch}`,
        BIN
      )
}

export interface FfmpegRun {
  /** Full argument list; the LAST element must be a real output file path — ffmpeg writes a sibling temp file that is renamed into place on success (no stdout `-`). */
  args: string[]
  /** Total duration in seconds; turns stderr `time=` into 0..1 progress. */
  durationSec?: number
  onProgress?: (ratio: number) => void
  signal?: AbortSignal
}

const TIME_RE = /time=(\d+):(\d+):([\d.]+)/
const TAIL_LINES = 20

/** Seconds from an ffmpeg progress line (`… time=00:01:05.50 …`), or null. */
export function parseTimeSec(line: string): number | null {
  const m = TIME_RE.exec(line)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

export function runFfmpeg(run: FfmpegRun, bin: string = ffmpegPath()): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = run.args.at(-1)
    // ffmpeg writes to a sibling temp file (same directory, same extension so
    // its muxer detection still works) and we rename into place only on
    // success — a failed or aborted run then never touches a pre-existing
    // destination, since ffmpeg's own -y never sees the real path.
    const tmp =
      output !== undefined
        ? (() => {
            const { dir, name, ext } = parse(output)
            return join(dir, `${name}.snapkit-tmp-${randomBytes(3).toString('hex')}${ext}`)
          })()
        : undefined
    const spawnArgs = tmp !== undefined ? [...run.args.slice(0, -1), tmp] : run.args

    const child = spawn(bin, ['-hide_banner', '-nostdin', '-y', ...spawnArgs], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true
    })

    const tail: string[] = []
    let pending = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      // Progress lines end with \r, everything else with \n.
      const lines = (pending + chunk).split(/[\r\n]+/)
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (!line) continue
        tail.push(line)
        if (tail.length > TAIL_LINES) tail.shift()
        const t = parseTimeSec(line)
        if (t !== null && run.durationSec && run.onProgress) {
          run.onProgress(Math.min(1, t / run.durationSec))
        }
      }
    })

    const onAbort = (): void => {
      child.kill('SIGKILL')
    }
    run.signal?.addEventListener('abort', onAbort, { once: true })
    if (run.signal?.aborted) onAbort()

    // A failed spawn emits 'error' AND then 'close', so both paths guard on this.
    let settled = false

    const fail = (why: string): void => {
      if (settled) return
      settled = true
      // Best-effort cleanup: a locked/undeletable temp file must not mask the real error.
      const cleanup =
        tmp !== undefined ? rm(tmp, { force: true }).catch(() => undefined) : Promise.resolve()
      void cleanup.then(() => reject(new Error(why)))
    }

    child.on('error', (err) => {
      run.signal?.removeEventListener('abort', onAbort)
      fail(`ffmpeg failed to start: ${err.message}`)
    })
    child.on('close', (code) => {
      run.signal?.removeEventListener('abort', onAbort)
      if (run.signal?.aborted) return fail('ffmpeg cancelled')
      if (code !== 0) return fail(`ffmpeg exited with ${code}:\n${tail.join('\n')}`)
      if (settled) return
      settled = true
      if (tmp === undefined || output === undefined) {
        run.onProgress?.(1)
        return resolve()
      }
      rename(tmp, output)
        .then(() => {
          run.onProgress?.(1)
          resolve()
        })
        .catch((err: Error) => {
          void rm(tmp, { force: true })
            .catch(() => undefined)
            .then(() => reject(new Error(`ffmpeg output rename failed: ${err.message}`)))
        })
    })
  })
}
