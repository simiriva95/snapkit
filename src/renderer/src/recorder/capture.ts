import type { Rect, RecordSource } from '@shared/ipc'
import {
  outputSize,
  pickMimeType,
  RESOLUTION_BOX,
  videoBitrate,
  type RecordFormat,
  type RecordFps,
  type RecordResolution,
  type Size
} from '@shared/recordPlan'

/**
 * Capture setup shared by the recorder and the replay-buffer windows. Main
 * picks the source (display or window) in its DisplayMediaRequestHandler;
 * this module:
 *   - screen/window: uses the track directly, downscaled by constraints
 *     (aspect-preserving fit into the preset box — no canvas, no CPU cost)
 *   - area: full-resolution track → canvas crop scaled to the preset → captureStream
 *   - audio: system (loopback, requested raw/stereo) and/or mic, merged with an
 *     AudioContext when both are present
 *   - picks the MediaRecorder container (mp4 preferred, webm fallback) and bitrate
 */

export interface CaptureOptions {
  source: RecordSource
  rect?: Rect
  displaySize: { width: number; height: number }
  resolution: RecordResolution
  fps: RecordFps
  mic: boolean
  systemAudio: boolean
  format: RecordFormat
  /** The screen track ended (window closed, share stopped). */
  onEnded: () => void
}

export interface Capture {
  stream: MediaStream
  mimeType: string
  ext: RecordFormat
  videoBitsPerSecond: number
  release: () => Promise<void>
}

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

export async function setupCapture(o: CaptureOptions): Promise<Capture> {
  let display: MediaStream | null = null
  let mic: MediaStream | null = null
  let stopCanvas: (() => void) | null = null
  let audioCtx: AudioContext | null = null

  const release = async (): Promise<void> => {
    stopCanvas?.()
    display?.getTracks().forEach((t) => t.stop())
    mic?.getTracks().forEach((t) => t.stop())
    await audioCtx?.close().catch(() => undefined)
  }

  try {
    // Screen/window: let Chromium downscale into the preset box. Area: full-res track, canvas crops.
    const box =
      o.source !== 'area' && o.resolution !== 'native' ? RESOLUTION_BOX[o.resolution] : undefined
    display = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: o.fps,
        ...(box ? { width: { max: box.width }, height: { max: box.height } } : {})
      },
      audio: o.systemAudio ? RAW_STEREO : false
    })
    mic = o.mic
      ? await navigator.mediaDevices.getUserMedia({ audio: MIC_VOICE }).catch((err: unknown) => {
          console.warn('[capture] microphone unavailable, recording without it', err)
          return null
        })
      : null

    const screenTrack = display.getVideoTracks()[0]
    screenTrack.addEventListener('ended', o.onEnded)

    let videoTrack = screenTrack
    // Area only: the canvas size is the exact output size, so the bitrate can
    // be derived from it instead of the preset table.
    let canvasSize: Size | undefined
    if (o.source === 'area' && o.rect) {
      const crop = await cropToCanvas(display, o, o.rect)
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
      o.format,
      (m) => MediaRecorder.isTypeSupported(m),
      audioTrack !== undefined
    )
    if (!mime) throw new Error('MediaRecorder supports neither mp4 nor webm here')

    return {
      stream,
      mimeType: mime.mimeType,
      ext: mime.ext,
      videoBitsPerSecond: videoBitrate(o.resolution, o.fps, canvasSize),
      release
    }
  } catch (err) {
    await release()
    throw err
  }
}

/** Area recording: draw the selected region of the full-res track onto a preset-sized canvas. */
async function cropToCanvas(
  display: MediaStream,
  o: CaptureOptions,
  rect: Rect
): Promise<{ track: MediaStreamTrack; stop: () => void; size: Size }> {
  const video = document.createElement('video')
  video.srcObject = display
  video.muted = true
  await video.play()

  // Map the DIP selection onto video pixels (the track is HiDPI-sized).
  const fx = video.videoWidth / o.displaySize.width
  const fy = video.videoHeight / o.displaySize.height
  const sx = Math.max(0, Math.round(rect.x * fx))
  const sy = Math.max(0, Math.round(rect.y * fy))
  const sw = Math.min(Math.round(rect.width * fx), video.videoWidth - sx)
  const sh = Math.min(Math.round(rect.height * fy), video.videoHeight - sy)

  const canvas = document.createElement('canvas')
  const out = outputSize({ width: sw, height: sh }, o.resolution)
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

  const track = canvas.captureStream(o.fps).getVideoTracks()[0]
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

/** One audio track out of two: each source through its own gain into one destination. */
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
