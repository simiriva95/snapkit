import type { RecordJob } from '@shared/ipc'
import { setupCapture } from './capture'

/**
 * Hidden recorder page: one MediaRecorder over the stream that capture.ts sets
 * up (constraints, canvas crop for areas, audio mixing, container choice).
 * Main sends recordStart/recordStop; the encoded bytes go back via recordResult.
 */

let stopRequested = false
let stopFn: (() => void) | null = null

window.recorderApi.onStop(() => {
  stopRequested = true
  stopFn?.()
})

window.recorderApi.onStart((job) => {
  void record(job).catch((err: unknown) => {
    console.error('[recorder]', err)
    // Empty result → main tears the session down and tells the user why.
    window.recorderApi.sendResult(
      new ArrayBuffer(0),
      job.format,
      err instanceof Error ? err.message : String(err)
    )
  })
})

async function record(job: RecordJob): Promise<void> {
  const cap = await setupCapture({
    ...job,
    // The recorded window was closed / share ended → finish what we have.
    onEnded: () => {
      stopRequested = true
      stopFn?.()
    }
  })
  try {
    const recorder = new MediaRecorder(cap.stream, {
      mimeType: cap.mimeType,
      videoBitsPerSecond: cap.videoBitsPerSecond,
      audioBitsPerSecond: 128_000
    })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    const done = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
      // A fatal encoder error makes the recorder inactive and never fires onstop:
      // end the session now and save the chunks collected so far (no chunks →
      // main's empty-buffer path reports the failure).
      recorder.onerror = (e) => {
        console.error('[recorder] MediaRecorder error', e)
        stopRequested = true
        resolve()
        stopFn?.()
      }
    })
    recorder.start(1000)

    await new Promise<void>((resolve) => {
      stopFn = resolve
      if (stopRequested) resolve()
    })
    if (recorder.state !== 'inactive') recorder.stop()
    await done

    const blob = new Blob(chunks, { type: cap.mimeType })
    window.recorderApi.sendResult(await blob.arrayBuffer(), cap.ext)
  } finally {
    await cap.release()
  }
}
