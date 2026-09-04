import type { ReplayJob } from '@shared/ipc'
import { setupCapture, type Capture } from '../recorder/capture'

/**
 * Hidden replay-buffer page. One display stream, a MediaRecorder per 10 s
 * segment; the NEXT recorder starts before the current one stops so no frame
 * is lost at the boundary. Every finished segment is shipped to main, which
 * keeps the ring on disk. A "flush" rotates immediately so the clip can
 * include the seconds recorded since the last boundary.
 */

let stopRequested = false
let rotate: ((flushId?: number) => void) | null = null
/** A rotate that arrived while no wait was pending (during setup or a finish()); consumed by the next wait. */
let queued: { flushId?: number } | null = null

const requestRotate = (flushId?: number): void => {
  if (rotate) rotate(flushId)
  else queued = { flushId }
}

window.replayApi.onStop(() => {
  stopRequested = true
  requestRotate()
})
window.replayApi.onFlush((id) => requestRotate(id))
window.replayApi.onStart((job) => {
  void run(job).catch((err: unknown) => {
    console.error('[replay]', err)
    window.replayApi.sendError(err instanceof Error ? err.message : String(err))
  })
})

interface Running {
  finish: () => Promise<{ buffer: ArrayBuffer; durationMs: number }>
}

function startSegment(cap: Capture): Running {
  const rec = new MediaRecorder(cap.stream, {
    mimeType: cap.mimeType,
    videoBitsPerSecond: cap.videoBitsPerSecond,
    audioBitsPerSecond: 128_000
  })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  const stopped = new Promise<void>((resolve) => {
    rec.onstop = () => resolve()
    rec.onerror = (e) => {
      console.error('[replay] MediaRecorder error', e)
      resolve()
    }
  })
  const startedAt = performance.now()
  rec.start()
  return {
    finish: async () => {
      if (rec.state !== 'inactive') rec.stop()
      await stopped
      const blob = new Blob(chunks, { type: cap.mimeType })
      return {
        buffer: await blob.arrayBuffer(),
        durationMs: Math.round(performance.now() - startedAt)
      }
    }
  }
}

/** Resolves after ms, or earlier when rotate() is called (with an optional flush id). */
function waitRotate(ms: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    if (queued) {
      const { flushId } = queued
      queued = null
      resolve(flushId)
      return
    }
    const timer = setTimeout(() => {
      rotate = null
      resolve(undefined)
    }, ms)
    rotate = (flushId) => {
      clearTimeout(timer)
      rotate = null
      resolve(flushId)
    }
  })
}

async function run(job: ReplayJob): Promise<void> {
  const cap = await setupCapture({
    source: 'screen',
    displaySize: job.displaySize,
    resolution: job.resolution,
    fps: job.fps,
    mic: job.mic,
    systemAudio: job.systemAudio,
    format: 'mp4',
    onEnded: () => {
      // Display unplugged / capture revoked: main restarts the buffer on this error.
      stopRequested = true
      requestRotate()
      window.replayApi.sendError('screen capture ended')
    }
  })
  try {
    let current = startSegment(cap)
    while (true) {
      const flushId = await waitRotate(job.segmentSec * 1000)
      const next = stopRequested ? null : startSegment(cap)
      const seg = await current.finish()
      if (seg.buffer.byteLength > 0) {
        window.replayApi.sendSegment(seg.buffer, seg.durationMs, cap.ext, flushId)
      } else if (flushId !== undefined) {
        // A flush must always be answered, or main waits for its timeout.
        window.replayApi.sendSegment(new ArrayBuffer(0), 0, cap.ext, flushId)
      }
      if (!next) break
      if (stopRequested) {
        // Stop landed while the previous segment was finishing: close the new one too.
        const tail = await next.finish()
        if (tail.buffer.byteLength > 0) {
          window.replayApi.sendSegment(tail.buffer, tail.durationMs, cap.ext)
        }
        break
      }
      current = next
    }
  } finally {
    await cap.release()
  }
}
