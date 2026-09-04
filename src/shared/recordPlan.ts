/**
 * Pure decisions for screen recording: output size per preset, bitrate per
 * preset × fps, MediaRecorder container choice. No DOM, no Electron — golden-tested.
 * Bitrate and size are keyed off the PRESET on purpose: Chromium's
 * track.getSettings() does not report the real captured size (V0 spike).
 */

export type RecordResolution = 'native' | 1440 | 1080 | 720
export type RecordFps = 30 | 60
export type RecordFormat = 'mp4' | 'webm'

export interface Size {
  width: number
  height: number
}

/** Preset = max box; the source is fitted inside, aspect preserved, never upscaled. */
export const RESOLUTION_BOX: Record<Exclude<RecordResolution, 'native'>, Size> = {
  1440: { width: 2560, height: 1440 },
  1080: { width: 1920, height: 1080 },
  720: { width: 1280, height: 720 }
}

// Even dimensions: H.264 4:2:0 needs them, and MediaRecorder rejects odd canvases on some GPUs.
const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

export function outputSize(source: Size, resolution: RecordResolution): Size {
  if (resolution === 'native') return { width: even(source.width), height: even(source.height) }
  const box = RESOLUTION_BOX[resolution]
  const scale = Math.min(1, box.width / source.width, box.height / source.height)
  return {
    width: even(source.width * scale),
    height: even(source.height * scale)
  }
}

// Mbps. ponytail: fixed table; content-adaptive bitrate if files come out too big/small.
const MBPS: Record<RecordResolution, Record<RecordFps, number>> = {
  native: { 30: 16, 60: 25 },
  1440: { 30: 12, 60: 20 },
  1080: { 30: 8, 60: 12 },
  720: { 30: 5, 60: 8 }
}

export function videoBitrate(resolution: RecordResolution, fps: RecordFps): number {
  return MBPS[resolution][fps] * 1_000_000
}

const CANDIDATES: Record<RecordFormat, string[]> = {
  mp4: ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4'],
  webm: ['video/webm;codecs=vp9,opus', 'video/webm']
}

/** First supported container for the wanted format; mp4 falls back to webm. */
export function pickMimeType(
  format: RecordFormat,
  isSupported: (mime: string) => boolean
): { mimeType: string; ext: RecordFormat } | null {
  const order: RecordFormat[] = format === 'mp4' ? ['mp4', 'webm'] : ['webm']
  for (const ext of order) {
    const mimeType = CANDIDATES[ext].find(isSupported)
    if (mimeType) return { mimeType, ext }
  }
  return null
}
