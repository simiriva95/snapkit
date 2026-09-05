import { describe, expect, it } from 'vitest'
import {
  clipFileName,
  clipSegments,
  concatListText,
  REPLAY_SECONDS,
  ringTrim,
  SEGMENT_SEC
} from './replayPlan'

const seg = (i: number, durationMs = 10_000) => ({ path: `seg-${i}.mp4`, durationMs })

describe('constants', () => {
  it('exposes the preset list and the segment length', () => {
    expect(REPLAY_SECONDS).toEqual([0, 30, 60, 120, 300])
    expect(SEGMENT_SEC).toBe(10)
  })
})

describe('ringTrim', () => {
  it('keeps enough newest segments to cover keepMs plus one extra', () => {
    const all = [1, 2, 3, 4, 5, 6].map((i) => seg(i))
    const { keep, drop } = ringTrim(all, 30_000)
    // 30 s needs 3 segments; +1 safety = 4 newest
    expect(keep.map((s) => s.path)).toEqual(['seg-3.mp4', 'seg-4.mp4', 'seg-5.mp4', 'seg-6.mp4'])
    expect(drop.map((s) => s.path)).toEqual(['seg-1.mp4', 'seg-2.mp4'])
  })
  it('counts real durations, so short flush segments do not shrink the window', () => {
    const all = [seg(1), seg(2), seg(3), seg(4, 1_500)]
    const { keep } = ringTrim(all, 30_000)
    // 1.5 + 10 + 10 = 21.5 < 30 → need seg-1 too, +1 extra is none left
    expect(keep.map((s) => s.path)).toEqual(['seg-1.mp4', 'seg-2.mp4', 'seg-3.mp4', 'seg-4.mp4'])
  })
  it('keeps everything while the buffer is still filling', () => {
    const { keep, drop } = ringTrim([seg(1)], 60_000)
    expect(keep).toHaveLength(1)
    expect(drop).toHaveLength(0)
  })
  it('keepMs 0 keeps nothing; an empty ring stays empty', () => {
    expect(ringTrim([seg(1), seg(2)], 0)).toEqual({ keep: [], drop: [seg(1), seg(2)] })
    expect(ringTrim([], 30_000)).toEqual({ keep: [], drop: [] })
  })
  it('preserves order (oldest first)', () => {
    const { keep } = ringTrim([seg(1), seg(2), seg(3)], 10_000)
    expect(keep.map((s) => s.path)).toEqual(['seg-2.mp4', 'seg-3.mp4'])
  })
})

describe('clipSegments', () => {
  it('takes the smallest suffix that covers keepMs — never seeks inside a segment', () => {
    const all = [seg(1), seg(2), seg(3), seg(4), seg(5, 3_000)]
    // 3 + 10 + 10 + 10 = 33 ≥ 30 → the last four
    expect(clipSegments(all, 30_000).map((s) => s.path)).toEqual([
      'seg-2.mp4',
      'seg-3.mp4',
      'seg-4.mp4',
      'seg-5.mp4'
    ])
  })
  it('returns everything while the buffer is still filling', () => {
    expect(clipSegments([seg(1), seg(2, 4_000)], 30_000)).toHaveLength(2)
  })
  it('an exact fit needs no extra segment', () => {
    expect(clipSegments([seg(1), seg(2), seg(3), seg(4)], 30_000).map((s) => s.path)).toEqual([
      'seg-2.mp4',
      'seg-3.mp4',
      'seg-4.mp4'
    ])
  })
})

describe('concatListText', () => {
  it('writes one file directive per line and escapes single quotes', () => {
    expect(concatListText(['/tmp/a.mp4', "/tmp/o'neil.mp4"])).toBe(
      "file '/tmp/a.mp4'\nfile '/tmp/o'\\''neil.mp4'\n"
    )
  })
})

describe('clipFileName', () => {
  it('formats like the other Snapkit file names', () => {
    expect(clipFileName(new Date(2026, 8, 4, 14, 5, 9), 'mp4')).toBe(
      'Snapkit Clip 2026-09-04 at 14.05.09.mp4'
    )
  })
})
