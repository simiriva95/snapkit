/**
 * Pure ffmpeg argument builders. No I/O, no electron — unit-tested goldens.
 * Contract with runFfmpeg(): the OUTPUT PATH IS ALWAYS THE LAST ELEMENT and
 * the global flags (-hide_banner -nostdin -y) are added by the wrapper.
 */

export type Container = 'mp4' | 'webm'
export type Quality = 'high' | 'medium' | 'low'

export interface TranscodeOpts {
  container: Container
  /** Output height; width follows the aspect ratio (even). */
  height?: 1440 | 1080 | 720 | 480
  /** CRF preset. Ignored when targetMB is set. Default 'medium'. */
  quality?: Quality
  /** Aim for this file size instead of a quality level. */
  targetMB?: number
  /** Duration of the SOURCE in seconds (before any trim). */
  durationSec: number
  mute?: boolean
  inSec?: number
  outSec?: number
}

const AUDIO_KBPS = 128
const MIN_VIDEO_KBPS = 300
// ffmpeg's `k` suffix is DECIMAL (1000), so a megabyte of budget is 8000 kbit.
// Using 8192 mixes MiB with decimal k and overshoots the target by ~2.4%.
const KBIT_PER_MB = 8000
const CRF: Record<Container, Record<Quality, number>> = {
  mp4: { high: 18, medium: 23, low: 28 },
  webm: { high: 30, medium: 35, low: 40 }
}

const range = (inSec?: number, outSec?: number): string[] => [
  ...(inSec !== undefined ? ['-ss', String(inSec)] : []),
  ...(outSec !== undefined ? ['-to', String(outSec)] : [])
]

/** Video bitrate (kbps) that lands a file of targetMB over durationSec. */
export function videoKbpsForTarget(targetMB: number, durationSec: number, mute: boolean): number {
  // Chromium reports Infinity/NaN duration for a fresh MediaRecorder blob, and a
  // zero-length trim gives 0 — all three would silently produce a garbage bitrate.
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new RangeError('videoKbpsForTarget: durationSec must be a positive finite number')
  }
  // ponytail: single-pass ABR with maxrate; two-pass if exact sizes ever matter.
  const totalKbps = (targetMB * KBIT_PER_MB) / durationSec
  return Math.max(MIN_VIDEO_KBPS, Math.round(totalKbps - (mute ? 0 : AUDIO_KBPS)))
}

/** Lossless, instant cut. ponytail: cuts land on keyframes; use transcodeArgs for frame accuracy. */
export function trimArgs(input: string, output: string, inSec: number, outSec: number): string[] {
  return [
    ...range(inSec, outSec),
    '-i',
    input,
    '-c',
    'copy',
    '-avoid_negative_ts',
    'make_zero',
    output
  ]
}

/**
 * Join same-encoded segments listed in an ffmpeg concat file (`file 'x.mp4'` per line).
 * fromSec > 0 drops the head (output-side seek; keyframe-bound, fine for replay clips).
 */
export function concatArgs(listFile: string, output: string, fromSec?: number): string[] {
  return [
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listFile,
    ...(fromSec !== undefined && fromSec > 0 ? ['-ss', String(fromSec)] : []),
    '-c',
    'copy',
    output
  ]
}

export function transcodeArgs(input: string, output: string, o: TranscodeOpts): string[] {
  const args = [...range(o.inSec, o.outSec), '-i', input]
  if (o.height) args.push('-vf', `scale=-2:${o.height}`)

  if (o.container === 'mp4') {
    // ponytail: libx264 everywhere for identical output across OSes; h264_videotoolbox / nvenc if speed complaints.
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart'
    )
  } else {
    args.push('-c:v', 'libvpx-vp9')
  }

  if (o.targetMB !== undefined) {
    const kept = (o.outSec ?? o.durationSec) - (o.inSec ?? 0)
    const kbps = videoKbpsForTarget(o.targetMB, kept, !!o.mute)
    args.push('-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`)
  } else {
    args.push('-crf', String(CRF[o.container][o.quality ?? 'medium']))
    if (o.container === 'webm') args.push('-b:v', '0') // CRF mode for vp9
  }

  if (o.mute) args.push('-an')
  else args.push('-c:a', o.container === 'mp4' ? 'aac' : 'libopus', '-b:a', `${AUDIO_KBPS}k`)

  args.push(output)
  return args
}

export function gifArgs(
  input: string,
  output: string,
  o: { fps: number; width?: number; inSec?: number; outSec?: number }
): string[] {
  const scale = o.width ? `,scale=${o.width}:-1:flags=lanczos` : ''
  const filter =
    `fps=${o.fps}${scale},split[a][b];` +
    '[a]palettegen=stats_mode=diff[p];' +
    '[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle'
  return [...range(o.inSec, o.outSec), '-i', input, '-vf', filter, '-loop', '0', output]
}
