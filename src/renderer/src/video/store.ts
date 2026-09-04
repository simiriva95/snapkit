import { create } from 'zustand'
import type { VideoExportResult, VideoOpenPayload } from '@shared/ipc'
import { defaultEdits, normalizeEdits, type ExportEdits, type VideoMeta } from '@shared/videoPlan'

interface VideoState {
  file: VideoOpenPayload | null
  /** null until <video> fired loadedmetadata. */
  meta: VideoMeta | null
  edits: ExportEdits | null
  playhead: number
  exporting: { progress: number } | null
  result: VideoExportResult | null
  /** Source problems (missing file, decode error) — export disabled while set. */
  sourceError: string | null
  /** Bumped on every open so the <video> remounts even for the same file. */
  openSeq: number

  setFile: (file: VideoOpenPayload) => void
  setMedia: (m: { durationSec: number; width: number; height: number }) => void
  setSourceError: (msg: string | null) => void
  patchEdits: (patch: Partial<ExportEdits>) => void
  setPlayhead: (t: number) => void
  runExport: () => Promise<void>
  cancelExport: () => void
}

export const useVideoStore = create<VideoState>((set, get) => ({
  file: null,
  meta: null,
  edits: null,
  playhead: 0,
  exporting: null,
  result: null,
  sourceError: null,
  openSeq: 0,

  setFile: (file) =>
    set((s) => ({
      file,
      meta: null,
      edits: null,
      playhead: 0,
      result: null,
      sourceError: null,
      openSeq: s.openSeq + 1
    })),
  setMedia: ({ durationSec, width, height }) => {
    const { file } = get()
    if (!file) return
    // A fragmented/unfinished file reports Infinity or NaN; there is nothing to trim.
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      set({ sourceError: 'Cannot determine the video duration (unsupported or unfinished file).' })
      return
    }
    const meta: VideoMeta = {
      durationSec,
      width,
      height,
      container: file.container,
      sizeBytes: file.sizeBytes
    }
    set({ meta, edits: defaultEdits(meta) })
  },
  setSourceError: (sourceError) => set({ sourceError }),
  patchEdits: (patch) => {
    const { edits, meta } = get()
    if (!edits || !meta) return
    set({ edits: normalizeEdits({ ...edits, ...patch }, meta), result: null })
  },
  setPlayhead: (playhead) => set({ playhead }),
  runExport: async () => {
    const { file, edits, meta, exporting } = get()
    if (!file || !edits || !meta || exporting) return
    set({ exporting: { progress: 0 }, result: null })
    try {
      const result = await window.videoApi.export({ path: file.path, edits, meta })
      set({ result: result.ok || !result.canceled ? result : null })
    } catch (err) {
      // A rejected invoke (main threw, window gone) must still clear the spinner.
      set({ result: { ok: false, error: err instanceof Error ? err.message : String(err) } })
    } finally {
      set({ exporting: null })
    }
  },
  cancelExport: () => window.videoApi.cancel()
}))
