import { describe, expect, it } from 'vitest'
import {
  canCopy,
  containerFromName,
  defaultEdits,
  estimateBytes,
  isTrimmed,
  normalizeEdits,
  planExport,
  type ExportEdits,
  type VideoMeta
} from './videoPlan'

const meta: VideoMeta = {
  durationSec: 60,
  width: 1920,
  height: 1080,
  container: 'mp4',
  sizeBytes: 60_000_000
}
const base: ExportEdits = defaultEdits(meta)

describe('defaultEdits', () => {
  it('starts as a full-length, same-container, original-quality export', () => {
    expect(base).toEqual({
      inSec: 0,
      outSec: 60,
      container: 'mp4',
      height: 'native',
      mode: { kind: 'copy' },
      mute: false,
      gifFps: 15,
      gifMaxWidth: 640
    })
  })
  it('a non mp4/webm source defaults to mp4 medium (copy is impossible)', () => {
    const e = defaultEdits({ ...meta, container: 'other' })
    expect(e.container).toBe('mp4')
    expect(e.mode).toEqual({ kind: 'quality', quality: 'medium' })
  })
})

describe('isTrimmed / canCopy', () => {
  it('a range within 10 ms of the full length is not a trim', () => {
    expect(isTrimmed({ ...base, inSec: 0.005, outSec: 59.995 }, meta)).toBe(false)
    expect(isTrimmed({ ...base, inSec: 1 }, meta)).toBe(true)
    expect(isTrimmed({ ...base, outSec: 30 }, meta)).toBe(true)
  })
  it('copy needs same container, native height and audio kept', () => {
    expect(canCopy(base, meta)).toBe(true)
    expect(canCopy({ ...base, container: 'webm' }, meta)).toBe(false)
    expect(canCopy({ ...base, height: 720 }, meta)).toBe(false)
    expect(canCopy({ ...base, mute: true }, meta)).toBe(false)
    expect(canCopy({ ...base, container: 'gif' }, meta)).toBe(false)
  })
})

describe('normalizeEdits', () => {
  it('drops copy mode when copy is no longer possible', () => {
    expect(normalizeEdits({ ...base, height: 720 }, meta).mode).toEqual({
      kind: 'quality',
      quality: 'medium'
    })
  })
  it('hides heights that are not smaller than the source', () => {
    expect(normalizeEdits({ ...base, height: 1080 }, meta).height).toBe('native')
    expect(
      normalizeEdits({ ...base, height: 720, mode: { kind: 'quality', quality: 'low' } }, meta)
        .height
    ).toBe(720)
  })
  it('clamps and orders the trim range, keeping at least one frame', () => {
    const e = normalizeEdits({ ...base, inSec: -5, outSec: 999 }, meta)
    expect(e.inSec).toBe(0)
    expect(e.outSec).toBe(60)
    const f = normalizeEdits({ ...base, inSec: 30, outSec: 30 }, meta)
    expect(f.outSec - f.inSec).toBeCloseTo(1 / 30)
  })
  it('gif ignores mute and copy', () => {
    const e = normalizeEdits({ ...base, container: 'gif', mute: true }, meta)
    expect(e.mute).toBe(false)
    expect(e.mode.kind).toBe('quality')
  })
})

describe('planExport', () => {
  it('copy: trim-only export is a stream copy', () => {
    const p = planExport({ ...base, inSec: 2, outSec: 10 }, meta, 'in.mp4', 'out.mp4')
    expect(p.kind).toBe('copy')
    expect(p.args).toEqual([
      '-ss',
      '2',
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
  it('copy without a trim still remuxes the whole file', () => {
    expect(planExport(base, meta, 'in.mp4', 'out.mp4').args).toEqual([
      '-i',
      'in.mp4',
      '-c',
      'copy',
      '-avoid_negative_ts',
      'make_zero',
      'out.mp4'
    ])
  })
  it('gif: fps and width capped at the source width', () => {
    const p = planExport(
      { ...base, container: 'gif', gifFps: 10, gifMaxWidth: 4000, inSec: 1, outSec: 4 },
      meta,
      'in.mp4',
      'out.gif'
    )
    expect(p.kind).toBe('gif')
    expect(p.args.slice(0, 6)).toEqual(['-ss', '1', '-to', '4', '-i', 'in.mp4'])
    expect(p.args[p.args.indexOf('-vf') + 1]).toContain('fps=10,scale=1920:-1:flags=lanczos')
    expect(p.args.at(-1)).toBe('out.gif')
  })
  it('transcode: quality mode, scaled, muted, trimmed', () => {
    const p = planExport(
      {
        ...base,
        container: 'webm',
        height: 720,
        mode: { kind: 'quality', quality: 'high' },
        mute: true,
        inSec: 5,
        outSec: 15
      },
      meta,
      'in.mp4',
      'out.webm'
    )
    expect(p.kind).toBe('transcode')
    expect(p.args).toEqual([
      '-ss',
      '5',
      '-to',
      '15',
      '-i',
      'in.mp4',
      '-vf',
      'scale=-2:720',
      '-c:v',
      'libvpx-vp9',
      '-crf',
      '30',
      '-b:v',
      '0',
      '-an',
      'out.webm'
    ])
  })
  it('transcode: target size passes the source duration so the trimmed length is used', () => {
    const p = planExport(
      { ...base, mode: { kind: 'size', targetMB: 5 }, inSec: 10, outSec: 20 },
      meta,
      'in.mp4',
      'out.mp4'
    )
    // 5 MB over 10 s = 4000 kbps − 128 audio = 3872
    expect(p.args).toContain('3872k')
  })
})

describe('estimateBytes', () => {
  it('copy: proportional share of the source size', () => {
    expect(estimateBytes({ ...base, inSec: 0, outSec: 30 }, meta)).toBe(30_000_000)
  })
  it('size mode: the target itself', () => {
    expect(estimateBytes({ ...base, mode: { kind: 'size', targetMB: 5 } }, meta)).toBe(5_000_000)
  })
  it('quality mode: bits per pixel × frames + audio', () => {
    // 1920×1080 × 30 fps × 0.08 bpp × 60 s / 8 + 128 kbps × 60 s / 8
    const e = { ...base, mode: { kind: 'quality', quality: 'medium' } as const }
    expect(estimateBytes(e, meta)).toBe(
      Math.round((1920 * 1080 * 30 * 0.08 * 60) / 8 + (128_000 * 60) / 8)
    )
  })
  it('gif: ~0.12 bytes per pixel per frame', () => {
    const e = {
      ...base,
      container: 'gif' as const,
      gifFps: 10 as const,
      gifMaxWidth: 640,
      inSec: 0,
      outSec: 10
    }
    expect(estimateBytes(e, meta)).toBe(Math.round(640 * 360 * 10 * 10 * 0.12))
  })
})

describe('containerFromName', () => {
  it('mp4 (case-insensitive)', () => expect(containerFromName('a.MP4')).toBe('mp4'))
  it('m4v is an mp4 container', () => expect(containerFromName('b.m4v')).toBe('mp4'))
  it('webm', () => expect(containerFromName('c.webm')).toBe('webm'))
  it('anything else is other', () => expect(containerFromName('d.mov')).toBe('other'))
})
