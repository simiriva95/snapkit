import { create } from 'zustand'
import type { CapturePayload } from '@shared/ipc'

interface CaptureState {
  /** Last finished capture, shown in the editor. */
  image: CapturePayload | null
  setImage: (image: CapturePayload) => void
  clear: () => void
}

export const useCaptureStore = create<CaptureState>((set) => ({
  image: null,
  setImage: (image) => set({ image }),
  clear: () => set({ image: null })
}))
