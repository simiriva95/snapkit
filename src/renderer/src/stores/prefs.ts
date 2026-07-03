import { create } from 'zustand'
import type { Prefs } from '@shared/prefs'

interface PrefsState {
  /** null until loaded from main at startup. */
  prefs: Prefs | null
  load: () => Promise<void>
  /** Patch prefs; returns an error message if main rejected (bad shortcut). */
  save: (patch: Partial<Prefs>) => Promise<string | null>
}

export const usePrefsStore = create<PrefsState>((set) => ({
  prefs: null,
  load: async () => {
    set({ prefs: await window.api.getPrefs() })
  },
  save: async (patch) => {
    const result = await window.api.setPrefs(patch)
    set({ prefs: result.prefs })
    return result.ok ? null : result.error
  }
}))
