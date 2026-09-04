import type { Rect, RecordJob } from '@shared/ipc'
import {
  outputSize,
  pickMimeType,
  RESOLUTION_BOX,
  videoBitrate,
  type Size
} from '@shared/recordPlan'

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

const MIC_VOICE: MediaTrackConstraints = {
  // Deliberately the opposite of RAW_STEREO: AEC keeps the system audio from
  // being captured a second time through speaker bleed, and NS/AGC are what a
  // voice-over track wants. Mono — a commentary track needs no stereo image.
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1
}

/** Mixing two sources at unity gain clips; -2 dB each leaves headroom. */
const MIX_GAIN = 0.8

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
      ? await navigator.mediaDevices.getUserMedia({ audio: MIC_VOICE }).catch((err: unknown) => {
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
    // Area only: the canvas size is the exact output size, so the bitrate can
    // be derived from it instead of the preset table.
    let canvasSize: Size | undefined
    if (job.source === 'area' && job.rect) {
      const crop = await cropToCanvas(display, job, job.rect)
      videoTrack = crop.track
      stopCanvas = crop.stop
      canvasSize = crop.size
    }

    const systemTrack = display.getAudioTracks()[0]
    const micTrack = mic?.getAudioTracks()[0]
    let audioTrack: MediaStreamTrack | undefined
    if (systemTrack && micTrack) {
      // 48 kHz: what both Opus and AAC want, and what loopback capture delivers.
      audioCtx = new AudioContext({ sampleRate: 48000 })
      audioTrack = mergeAudio(audioCtx, systemTrack, micTrack)
    } else {
      audioTrack = systemTrack ?? micTrack
    }
    const stream = new MediaStream(audioTrack ? [videoTrack, audioTrack] : [videoTrack])

    const mime = pickMimeType(
      job.format,
      (m) => MediaRecorder.isTypeSupported(m),
      audioTrack !== undefined
    )
    if (!mime) throw new Error('MediaRecorder supports neither mp4 nor webm here')

    const recorder = new MediaRecorder(stream, {
      mimeType: mime.mimeType,
      videoBitsPerSecond: videoBitrate(job.resolution, job.fps, canvasSize),
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
): Promise<{ track: MediaStreamTrack; stop: () => void; size: Size }> {
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
  return {
    track,
    stop: () => {
      cancelAnimationFrame(raf)
      track.stop()
      video.srcObject = null
    },
    size: out
  }
}

/** One audio track out of up to two: pass-through for one source, mixed for two. */
function mergeAudio(
  ctx: AudioContext,
  system: MediaStreamTrack,
  mic: MediaStreamTrack
): MediaStreamTrack {
  const dest = ctx.createMediaStreamDestination()
  for (const t of [system, mic]) {
    const gain = ctx.createGain()
    gain.gain.value = MIX_GAIN
    ctx
      .createMediaStreamSource(new MediaStream([t]))
      .connect(gain)
      .connect(dest)
  }
  return dest.stream.getAudioTracks()[0]
}
