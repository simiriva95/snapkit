import type { Rect, RecordJob } from '@shared/ipc'
import { outputSize, pickMimeType, RESOLUTION_BOX, videoBitrate } from '@shared/recordPlan'

/**
 * Hidden recorder page. Main picks the source (display or window) in its
 * DisplayMediaRequestHandler; this page:
 *   - screen/window: records the track directly, downscaled by constraints
 *     (aspect-preserving fit into the preset box — no canvas, no CPU cost)
 *   - area: full-resolution track → canvas crop scaled to the preset → captureStream
 *   - audio: system (loopback, requested raw/stereo) and/or mic, merged with an
 *     AudioContext when both are present
 *   - MediaRecorder mp4 (H.264+AAC) — falls back to webm if unsupported
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

const RAW_STEREO: MediaTrackConstraints = {
  // Chromium voice-processes the loopback track by default (mono, AGC, NS, AEC) — V0 spike.
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 2
}

async function record(job: RecordJob): Promise<void> {
  let display: MediaStream | null = null
  let mic: MediaStream | null = null
  let stopCanvas: (() => void) | null = null
  let audioCtx: AudioContext | null = null

  try {
    // Screen/window: let Chromium downscale into the preset box. Area: full-res track, canvas crops.
    const box =
      job.source !== 'area' && job.resolution !== 'native'
        ? RESOLUTION_BOX[job.resolution]
        : undefined
    display = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: job.fps,
        ...(box ? { width: { max: box.width }, height: { max: box.height } } : {})
      },
      audio: job.systemAudio ? RAW_STEREO : false
    })
    mic = job.mic
      ? await navigator.mediaDevices.getUserMedia({ audio: true }).catch((err: unknown) => {
          console.warn('[recorder] microphone unavailable, recording without it', err)
          return null
        })
      : null

    const screenTrack = display.getVideoTracks()[0]
    // The recorded window was closed / share ended → finish what we have.
    screenTrack.addEventListener('ended', () => {
      stopRequested = true
      stopFn?.()
    })

    let videoTrack = screenTrack
    if (job.source === 'area' && job.rect) {
      const crop = await cropToCanvas(display, job, job.rect)
      videoTrack = crop.track
      stopCanvas = crop.stop
    }

    const systemTrack = display.getAudioTracks()[0]
    const micTrack = mic?.getAudioTracks()[0]
    let audioTrack: MediaStreamTrack | undefined
    if (systemTrack || micTrack) {
      audioCtx = new AudioContext()
      audioTrack = mergeAudio(audioCtx, systemTrack, micTrack)
    }
    const stream = new MediaStream(audioTrack ? [videoTrack, audioTrack] : [videoTrack])

    const mime = pickMimeType(job.format, (m) => MediaRecorder.isTypeSupported(m))
    if (!mime) throw new Error('MediaRecorder supports neither mp4 nor webm here')

    const recorder = new MediaRecorder(stream, {
      mimeType: mime.mimeType,
      videoBitsPerSecond: videoBitrate(job.resolution, job.fps),
      audioBitsPerSecond: 128_000
    })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
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

    const blob = new Blob(chunks, { type: mime.mimeType })
    window.recorderApi.sendResult(await blob.arrayBuffer(), mime.ext)
  } finally {
    stopCanvas?.()
    display?.getTracks().forEach((t) => t.stop())
    mic?.getTracks().forEach((t) => t.stop())
    await audioCtx?.close().catch(() => undefined)
  }
}

/** Area recording: draw the selected region of the full-res track onto a preset-sized canvas. */
async function cropToCanvas(
  display: MediaStream,
  job: RecordJob,
  rect: Rect
): Promise<{ track: MediaStreamTrack; stop: () => void }> {
  const video = document.createElement('video')
  video.srcObject = display
  video.muted = true
  await video.play()

  // Map the DIP selection onto video pixels (the track is HiDPI-sized).
  const fx = video.videoWidth / job.displaySize.width
  const fy = video.videoHeight / job.displaySize.height
  const sx = Math.max(0, Math.round(rect.x * fx))
  const sy = Math.max(0, Math.round(rect.y * fy))
  const sw = Math.min(Math.round(rect.width * fx), video.videoWidth - sx)
  const sh = Math.min(Math.round(rect.height * fy), video.videoHeight - sy)

  const canvas = document.createElement('canvas')
  const out = outputSize({ width: sw, height: sh }, job.resolution)
  canvas.width = out.width
  canvas.height = out.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')

  let raf = 0
  const draw = (): void => {
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    raf = requestAnimationFrame(draw)
  }
  draw()

  const track = canvas.captureStream(job.fps).getVideoTracks()[0]
  return { track, stop: () => cancelAnimationFrame(raf) }
}

/** One audio track out of up to two: pass-through for one source, mixed for two. */
function mergeAudio(
  ctx: AudioContext,
  system?: MediaStreamTrack,
  mic?: MediaStreamTrack
): MediaStreamTrack | undefined {
  if (!system || !mic) return system ?? mic
  const dest = ctx.createMediaStreamDestination()
  for (const t of [system, mic]) ctx.createMediaStreamSource(new MediaStream([t])).connect(dest)
  return dest.stream.getAudioTracks()[0]
}
