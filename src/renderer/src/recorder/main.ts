import type { RecordJob } from '@shared/ipc'

/**
 * Hidden recorder page. Receives the job from main, grabs the screen via
 * getDisplayMedia (main's DisplayMediaRequestHandler picks the right display,
 * no picker), crops the selection on a canvas and encodes via MediaRecorder
 * on canvas.captureStream.
 */

let stopRequested = false
let stopFn: (() => void) | null = null

window.recorderApi.onStop(() => {
  stopRequested = true
  stopFn?.()
})

window.recorderApi.onStart((job) => {
  void record(job).catch((err) => {
    console.error('[recorder]', err)
    // Report an empty result so main tears the session down instead of hanging.
    window.recorderApi.sendResult(new ArrayBuffer(0), job.format)
  })
})

async function record(job: RecordJob): Promise<void> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 },
    audio: false
  })

  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  await video.play()

  // Map the DIP selection onto video pixels (video is HiDPI-sized).
  const fx = video.videoWidth / job.displaySize.width
  const fy = video.videoHeight / job.displaySize.height
  const sx = Math.max(0, Math.round(job.rect.x * fx))
  const sy = Math.max(0, Math.round(job.rect.y * fy))
  const sw = Math.min(Math.round(job.rect.width * fx), video.videoWidth - sx)
  const sh = Math.min(Math.round(job.rect.height * fy), video.videoHeight - sy)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, sw)
  canvas.height = Math.max(2, sh)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')

  let raf = 0
  const draw = (): void => {
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    raf = requestAnimationFrame(draw)
  }
  draw()

  const cleanup = (): void => {
    cancelAnimationFrame(raf)
    stream.getTracks().forEach((t) => t.stop())
  }

  // WebM via MediaRecorder.
  const canvasStream = canvas.captureStream(30)
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm'
  const recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)

  const done = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })
  recorder.start(1000)

  await new Promise<void>((resolve) => {
    stopFn = resolve
    if (stopRequested) resolve()
  })
  recorder.stop()
  await done
  cleanup()

  const blob = new Blob(chunks, { type: 'video/webm' })
  window.recorderApi.sendResult(await blob.arrayBuffer(), 'webm')
}
