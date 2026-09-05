import { describe, expect, it } from 'vitest'
import { outputSize, pickMimeType, RESOLUTION_BOX, videoBitrate } from './recordPlan'

describe('outputSize', () => {
  it('native keeps the source size, rounded to even', () => {
    expect(outputSize({ width: 1001, height: 501 }, 'native')).toEqual({ width: 1002, height: 502 })
  })
  it('fits a Retina 16:10 screen into the 1080 box, aspect preserved', () => {
    // 3024x1964 → limited by height: 1964→1080 (×0.5499) → width 1662.9 → nearest even 1662
    expect(outputSize({ width: 3024, height: 1964 }, 1080)).toEqual({ width: 1662, height: 1080 })
  })
  it('fits a portrait region by height', () => {
    expect(outputSize({ width: 800, height: 1600 }, 720)).toEqual({ width: 360, height: 720 })
  })
  it('fits a very wide region by width', () => {
    expect(outputSize({ width: 3840, height: 400 }, 1080)).toEqual({ width: 1920, height: 200 })
  })
  it('never upscales', () => {
    expect(outputSize({ width: 1280, height: 720 }, 1080)).toEqual({ width: 1280, height: 720 })
  })
  it('fits 4K into the 1440 box', () => {
    expect(outputSize({ width: 3840, height: 2160 }, 1440)).toEqual({ width: 2560, height: 1440 })
  })
  it('never returns less than 2x2', () => {
    expect(outputSize({ width: 1, height: 1 }, 720)).toEqual({ width: 2, height: 2 })
  })
})

describe('RESOLUTION_BOX', () => {
  it('has the three preset boxes', () => {
    expect(RESOLUTION_BOX).toEqual({
      1440: { width: 2560, height: 1440 },
      1080: { width: 1920, height: 1080 },
      720: { width: 1280, height: 720 }
    })
  })
})

describe('videoBitrate', () => {
  it('follows the preset table (Mbps × 1e6)', () => {
    expect(videoBitrate(1080, 30)).toBe(8_000_000)
    expect(videoBitrate(1080, 60)).toBe(12_000_000)
    expect(videoBitrate(1440, 60)).toBe(20_000_000)
    expect(videoBitrate('native', 60)).toBe(25_000_000)
    expect(videoBitrate(720, 30)).toBe(5_000_000)
  })
  it('derives the bitrate from the exact output size when it is known', () => {
    // 1920x1080x30 x 0.1 bpp = 6.22 Mbps, under the 8 Mbps table value
    expect(videoBitrate(1080, 30, { width: 1920, height: 1080 })).toBe(6_220_800)
    expect(videoBitrate(720, 60, { width: 1280, height: 720 })).toBe(5_529_600)
  })
  it('never goes below 1 Mbps for a tiny region', () => {
    expect(videoBitrate('native', 30, { width: 400, height: 300 })).toBe(1_000_000)
  })
  it('never exceeds the preset table value', () => {
    expect(videoBitrate('native', 60, { width: 3840, height: 2160 })).toBe(25_000_000)
  })
})

describe('pickMimeType', () => {
  it('prefers mp4 with avc1+aac, then avc1, then plain mp4', () => {
    const only = (ok: string) => (m: string) => m === ok
    expect(pickMimeType('mp4', only('video/mp4;codecs=avc1,mp4a.40.2'), true)).toEqual({
      mimeType: 'video/mp4;codecs=avc1,mp4a.40.2',
      ext: 'mp4'
    })
    expect(pickMimeType('mp4', only('video/mp4;codecs=avc1'), true)).toEqual({
      mimeType: 'video/mp4;codecs=avc1',
      ext: 'mp4'
    })
    expect(pickMimeType('mp4', only('video/mp4'), true)).toEqual({
      mimeType: 'video/mp4',
      ext: 'mp4'
    })
  })
  it('falls back to webm when no mp4 flavour is supported', () => {
    const webmOnly = (m: string) => m.startsWith('video/webm')
    expect(pickMimeType('mp4', webmOnly, true)).toEqual({
      mimeType: 'video/webm;codecs=vp9,opus',
      ext: 'webm'
    })
  })
  it('webm prefers vp9+opus, then plain webm', () => {
    expect(pickMimeType('webm', (m) => m === 'video/webm', true)).toEqual({
      mimeType: 'video/webm',
      ext: 'webm'
    })
  })
  it('leaves the audio codec out of the mime when there is no audio track', () => {
    const only = (ok: string) => (m: string) => m === ok
    expect(pickMimeType('mp4', only('video/mp4;codecs=avc1'), false)).toEqual({
      mimeType: 'video/mp4;codecs=avc1',
      ext: 'mp4'
    })
    expect(pickMimeType('webm', (m) => m === 'video/webm;codecs=vp9', false)).toEqual({
      mimeType: 'video/webm;codecs=vp9',
      ext: 'webm'
    })
  })
  it('returns null when nothing is supported', () => {
    expect(pickMimeType('mp4', () => false, true)).toBeNull()
  })
})
