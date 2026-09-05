import { describe, expect, it, vi } from 'vitest'
// videoServe imports APP_URL from protocol.ts, which imports electron — mock it.
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd() }, net: {}, protocol: {} }))
import { parseRange } from './videoServe'

describe('parseRange', () => {
  it('no header → whole file', () => expect(parseRange(null, 100)).toBeNull())
  it('closed range', () => expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 }))
  it('open-ended range runs to the last byte', () =>
    expect(parseRange('bytes=100-', 1000)).toEqual({ start: 100, end: 999 }))
  it('end past the size is clamped', () =>
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 }))
  it('suffix range', () => expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 }))
  it('start beyond the size is unsatisfiable', () => expect(parseRange('bytes=1000-', 1000)).toBe('invalid'))
  it('garbage is unsatisfiable', () => expect(parseRange('bytes=abc', 1000)).toBe('invalid'))
  it('only the first range of a multi-range request is honoured', () =>
    expect(parseRange('bytes=0-9,20-29', 1000)).toEqual({ start: 0, end: 9 }))
})
