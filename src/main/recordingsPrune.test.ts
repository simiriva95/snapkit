import { describe, expect, it } from 'vitest'
import { staleRecordings } from './recordingsPrune'

const DAY = 86_400_000
describe('staleRecordings', () => {
  it('returns files older than 7 days, keeps newer ones', () => {
    const now = 10 * DAY
    const out = staleRecordings(
      [
        { path: 'a.mp4', mtimeMs: now - 8 * DAY },
        { path: 'b.mp4', mtimeMs: now - 6 * DAY },
        { path: 'c.webm', mtimeMs: now - 7 * DAY - 1 }
      ],
      now
    )
    expect(out).toEqual(['a.mp4', 'c.webm'])
  })
})
