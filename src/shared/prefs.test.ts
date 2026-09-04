import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, normalizePrefs, type Prefs } from './prefs'

describe('normalizePrefs', () => {
  it('migrates the removed gif recording format to mp4', () => {
    const stored = { ...DEFAULT_PREFS, recordFormat: 'gif' } as unknown as Prefs
    expect(normalizePrefs(stored).recordFormat).toBe('mp4')
  })
  it('keeps webm', () => {
    expect(normalizePrefs({ ...DEFAULT_PREFS, recordFormat: 'webm' }).recordFormat).toBe('webm')
  })
  it('fills fields missing from an older store with defaults', () => {
    const partial = { theme: 'light' } as unknown as Prefs
    const p = normalizePrefs(partial)
    expect(p.theme).toBe('light')
    expect(p.recordResolution).toBe('native')
    expect(p.recordFps).toBe(30)
    expect(p.recordMic).toBe(false)
    expect(p.recordSystemAudio).toBe(true)
    expect(p.recordScreenShortcut).toBe('CommandOrControl+Shift+9')
    expect(p.recordWindowShortcut).toBe('CommandOrControl+Shift+0')
  })
})
