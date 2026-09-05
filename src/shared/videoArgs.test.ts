import { describe, expect, it } from 'vitest'
import { concatArgs, gifArgs, transcodeArgs, trimArgs, videoKbpsForTarget } from './videoArgs'

describe('trimArgs', () => {
  it('seeks on the input and stream-copies', () => {
    expect(trimArgs('in.mp4', 'out.mp4', 2.5, 10)).toEqual([
      '-ss',
      '2.5',
      '-to',
      '10',
      '-i',
      'in.mp4',
      '-c',
      'copy',
      '-avoid_negative_ts',
      'make_zero',
      'out.mp4'
    ])
  })
})

describe('concatArgs', () => {
  it('concatenates a list file with stream copy', () => {
    expect(concatArgs('list.txt', 'clip.mp4')).toEqual([
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'list.txt',
      '-c',
      'copy',
      'clip.mp4'
    ])
  })
  it('drops the head with an output-side -ss when fromSec is given', () => {
    expect(concatArgs('list.txt', 'clip.mp4', 12.5)).toEqual([
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'list.txt',
      '-ss',
      '12.5',
      '-c',
      'copy',
      'clip.mp4'
    ])
  })
  it('ignores a zero/negative fromSec', () => {
    expect(concatArgs('list.txt', 'clip.mp4', 0)).not.toContain('-ss')
    expect(concatArgs('list.txt', 'clip.mp4', -3)).not.toContain('-ss')
  })
})

describe('videoKbpsForTarget', () => {
  it('budgets 8000 kbit per MB minus 128 kbps audio', () => {
    // ffmpeg's `k` is decimal: 10 MB over 60 s = 1333.3 kbps total → 1205 for video.
    expect(videoKbpsForTarget(10, 60, false)).toBe(1205)
  })
  it('gives the audio budget back when muted', () => {
    expect(videoKbpsForTarget(10, 60, true)).toBe(1333)
  })
  it('never goes below 300 kbps', () => {
    expect(videoKbpsForTarget(1, 600, false)).toBe(300)
  })
  it('rejects a non-positive or non-finite duration', () => {
    // Chromium hands back Infinity/NaN for a fresh MediaRecorder blob.
    expect(() => videoKbpsForTarget(10, 0, false)).toThrow(RangeError)
    expect(() => videoKbpsForTarget(10, Infinity, false)).toThrow(RangeError)
    expect(() => videoKbpsForTarget(10, NaN, false)).toThrow(RangeError)
  })
})

describe('transcodeArgs', () => {
  it('mp4 medium quality, no scaling, with audio', () => {
    expect(transcodeArgs('in.mov', 'out.mp4', { container: 'mp4', durationSec: 30 })).toEqual([
      '-i',
      'in.mov',
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      'out.mp4'
    ])
  })
  it('applies trim range, scale, quality and mute', () => {
    expect(
      transcodeArgs('in.mp4', 'out.mp4', {
        container: 'mp4',
        durationSec: 30,
        inSec: 5,
        outSec: 15,
        height: 720,
        quality: 'high',
        mute: true
      })
    ).toEqual([
      '-ss',
      '5',
      '-to',
      '15',
      '-i',
      'in.mp4',
      '-vf',
      'scale=-2:720',
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-crf',
      '18',
      '-an',
      'out.mp4'
    ])
  })
  it('target size uses the TRIMMED duration and caps the bitrate', () => {
    // 10 s kept out of 30 → 5 MB over 10 s = 4000 kbps → 3872 video.
    expect(
      transcodeArgs('in.mp4', 'out.mp4', {
        container: 'mp4',
        durationSec: 30,
        inSec: 10,
        outSec: 20,
        targetMB: 5
      })
    ).toEqual([
      '-ss',
      '10',
      '-to',
      '20',
      '-i',
      'in.mp4',
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-b:v',
      '3872k',
      '-maxrate',
      '3872k',
      '-bufsize',
      '7744k',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      'out.mp4'
    ])
  })
  it('webm uses vp9 in CRF mode and opus', () => {
    expect(
      transcodeArgs('in.mp4', 'out.webm', { container: 'webm', durationSec: 30, quality: 'low' })
    ).toEqual([
      '-i',
      'in.mp4',
      '-c:v',
      'libvpx-vp9',
      '-crf',
      '40',
      '-b:v',
      '0',
      '-c:a',
      'libopus',
      '-b:a',
      '128k',
      'out.webm'
    ])
  })
})

describe('gifArgs', () => {
  it('builds the palettegen/paletteuse chain with fps and width', () => {
    expect(gifArgs('in.mp4', 'out.gif', { fps: 15, width: 640, inSec: 1, outSec: 4 })).toEqual([
      '-ss',
      '1',
      '-to',
      '4',
      '-i',
      'in.mp4',
      '-vf',
      'fps=15,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
      '-loop',
      '0',
      'out.gif'
    ])
  })
  it('omits scale when no width is given', () => {
    expect(gifArgs('in.mp4', 'out.gif', { fps: 10 })[3]).toBe(
      'fps=10,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle'
    )
  })
})
