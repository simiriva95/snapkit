/**
 * Export model for the video editor and the pure planners that turn it into
 * an ffmpeg command (via videoArgs builders) or a size estimate. No I/O.
 */
import { gifArgs, transcodeArgs, trimArgs, type Quality } from './videoArgs'

export type ExportContainer = 'mp4' | 'webm' | 'gif'
export type ExportHeight = 'native' | 1080 | 720 | 480
export type GifFps = 10 | 15 | 20
export type CompressionMode =
  { kind: 'copy' } | { kind: 'quality'; quality: Quality } | { kind: 'size'; targetMB: number }

export interface ExportEdits {
  inSec: number
  outSec: number
  container: ExportContainer
  height: ExportHeight
  mode: CompressionMode
  mute: boolean
  gifFps: GifFps
  gifMaxWidth: number
}

export interface VideoMeta {
  durationSec: number
  width: number
  height: number
  /** Source container from the file extension; anything else is 'other'. */
  container: 'mp4' | 'webm' | 'other'
  sizeBytes: number
}

/** Source container from a file name or path; anything we cannot copy is 'other'. */
export function containerFromName(name: string): VideoMeta['container'] {
  const dot = name.lastIndexOf('.')
  const ext = dot === -1 ? '' : name.slice(dot).toLowerCase()
  if (ext === '.mp4' || ext === '.m4v') return 'mp4'
  if (ext === '.webm') return 'webm'
  return 'other'
}

/** The renderer does not know the source fps; one "frame" is 1/30 s. */
export const FRAME_SEC = 1 / 30
const TRIM_EPSILON = 0.01
const MEDIUM: CompressionMode = { kind: 'quality', quality: 'medium' }

export function defaultEdits(meta: VideoMeta): ExportEdits {
  return {
    inSec: 0,
    outSec: meta.durationSec,
    container: meta.container === 'other' ? 'mp4' : meta.container,
    height: 'native',
    mode: meta.container === 'other' ? MEDIUM : { kind: 'copy' },
    mute: false,
    gifFps: 15,
    gifMaxWidth: 640
  }
}

export function isTrimmed(e: ExportEdits, meta: VideoMeta): boolean {
  return e.inSec > TRIM_EPSILON || e.outSec < meta.durationSec - TRIM_EPSILON
}

/** Stream copy is only possible when nothing but the range changes. */
export function canCopy(e: ExportEdits, meta: VideoMeta): boolean {
  return e.container === meta.container && e.height === 'native' && !e.mute
}

export function normalizeEdits(e: ExportEdits, meta: VideoMeta): ExportEdits {
  const inSec = Math.min(Math.max(0, e.inSec), meta.durationSec - FRAME_SEC)
  const outSec = Math.min(Math.max(inSec + FRAME_SEC, e.outSec), meta.durationSec)
  const height = e.height !== 'native' && e.height >= meta.height ? 'native' : e.height
  const gif = e.container === 'gif'
  const mute = gif ? false : e.mute
  const next = { ...e, inSec, outSec, height, mute }
  // "Original" (stream copy) only survives while it is actually possible.
  const mode = e.mode.kind === 'copy' && (gif || !canCopy(next, meta)) ? MEDIUM : e.mode
  return { ...next, mode }
}

export function planExport(
  e: ExportEdits,
  meta: VideoMeta,
  input: string,
  output: string
): { kind: 'copy' | 'gif' | 'transcode'; args: string[] } {
  const trimmed = isTrimmed(e, meta)
  const range = trimmed ? { inSec: e.inSec, outSec: e.outSec } : {}

  if (e.container === 'gif') {
    return {
      kind: 'gif',
      args: gifArgs(input, output, {
        fps: e.gifFps,
        width: Math.min(e.gifMaxWidth, meta.width),
        ...range
      })
    }
  }
  if (e.mode.kind === 'copy' && canCopy(e, meta)) {
    return {
      kind: 'copy',
      args: trimmed
        ? trimArgs(input, output, e.inSec, e.outSec)
        : ['-i', input, '-c', 'copy', '-avoid_negative_ts', 'make_zero', output]
    }
  }
  return {
    kind: 'transcode',
    args: transcodeArgs(input, output, {
      container: e.container,
      height: e.height === 'native' ? undefined : e.height,
      quality: e.mode.kind === 'quality' ? e.mode.quality : undefined,
      targetMB: e.mode.kind === 'size' ? e.mode.targetMB : undefined,
      durationSec: meta.durationSec,
      mute: e.mute,
      ...range
    })
  }
}

// Rough bits per pixel per frame for H.264/VP9 screen content at each CRF tier.
const BPP: Record<Quality, number> = { high: 0.12, medium: 0.08, low: 0.05 }
const GIF_BYTES_PER_PIXEL_FRAME = 0.12
const AUDIO_BPS = 128_000
const ASSUMED_FPS = 30

/** Live estimate for the panel — order-of-magnitude, labelled "≈" in the UI. */
export function estimateBytes(e: ExportEdits, meta: VideoMeta): number {
  const seconds = Math.max(0, e.outSec - e.inSec)
  const scale = e.height === 'native' ? 1 : Math.min(1, e.height / meta.height)
  const w = Math.round(meta.width * scale)
  const h = Math.round(meta.height * scale)

  if (e.container === 'gif') {
    const gw = Math.min(e.gifMaxWidth, meta.width)
    const gh = Math.round((meta.height * gw) / meta.width)
    return Math.round(gw * gh * e.gifFps * seconds * GIF_BYTES_PER_PIXEL_FRAME)
  }
  if (e.mode.kind === 'size') return e.mode.targetMB * 1_000_000
  if (e.mode.kind === 'copy') return Math.round((meta.sizeBytes * seconds) / meta.durationSec)
  const video = (w * h * ASSUMED_FPS * BPP[e.mode.quality] * seconds) / 8
  const audio = e.mute ? 0 : (AUDIO_BPS * seconds) / 8
  return Math.round(video + audio)
}
