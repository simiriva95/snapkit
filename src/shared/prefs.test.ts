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
  it('clamps an unknown resolution preset to native', () => {
    const stored = { ...DEFAULT_PREFS, recordResolution: 999 } as unknown as Prefs
    expect(normalizePrefs(stored).recordResolution).toBe('native')
  })
  it('rejects a stringified resolution preset (electron-store JSON round-trip)', () => {
    const stored = { ...DEFAULT_PREFS, recordResolution: '1080' } as unknown as Prefs
    expect(normalizePrefs(stored).recordResolution).toBe('native')
  })
  it('keeps the valid resolution presets', () => {
    for (const r of ['native', 1440, 1080, 720] as const) {
      expect(normalizePrefs({ ...DEFAULT_PREFS, recordResolution: r }).recordResolution).toBe(r)
    }
  })
  it('clamps an unsupported frame rate to 30', () => {
    const stored = { ...DEFAULT_PREFS, recordFps: 24 } as unknown as Prefs
    expect(normalizePrefs(stored).recordFps).toBe(30)
  })
  it('keeps 60 fps', () => {
    expect(normalizePrefs({ ...DEFAULT_PREFS, recordFps: 60 }).recordFps).toBe(60)
  })
})

describe('replay prefs', () => {
  it('default off, ⌘⇧8, default clips dir, silent save', () => {
    expect(DEFAULT_PREFS.replayBuffer).toBe(0)
    expect(DEFAULT_PREFS.replayShortcut).toBe('CommandOrControl+Shift+8')
    expect(DEFAULT_PREFS.clipsDir).toBeNull()
    expect(DEFAULT_PREFS.clipOpenInEditor).toBe(false)
  })
  it('clamps an unknown replay length to off', () => {
    expect(normalizePrefs({ ...DEFAULT_PREFS, replayBuffer: 45 as never }).replayBuffer).toBe(0)
    expect(normalizePrefs({ ...DEFAULT_PREFS, replayBuffer: 120 }).replayBuffer).toBe(120)
  })
})
