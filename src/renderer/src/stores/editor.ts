import { create } from 'zustand'
import type { RedactionRegion } from '@shared/redaction'
import type { Annotation, Tool } from '@renderer/editor/annotations'
import {
  createHistory,
  commit,
  undo,
  redo,
  canUndo,
  canRedo,
  type History
} from '@renderer/editor/history'

export type RedactionStatus = 'idle' | 'running' | 'review'

interface EditorState {
  history: History<Annotation[]>
  selectedId: string | null
  tool: Tool
  // Defaults applied to newly created annotations.
  color: string
  strokeWidth: number
  highlightWidth: number
  fontSize: number
  pixelSize: number

  // Auto-redaction flow: idle → running (OCR) → review (proposals on canvas).
  redactionStatus: RedactionStatus
  redactionProgress: number
  redactionError: string | null
  proposals: RedactionRegion[]

  setTool: (tool: Tool) => void
  setColor: (color: string) => void
  setStrokeWidth: (w: number) => void
  setHighlightWidth: (w: number) => void
  setFontSize: (s: number) => void
  setPixelSize: (s: number) => void
  select: (id: string | null) => void

  /** Add a finished annotation (commits to history) and select it. */
  add: (anno: Annotation) => void
  /** Add several annotations as ONE history step (auto-redaction apply). */
  addMany: (annos: Annotation[]) => void

  startRedaction: () => void
  setRedactionProgress: (p: number) => void
  setRedactionError: (message: string) => void
  setProposals: (proposals: RedactionRegion[]) => void
  toggleProposal: (id: string) => void
  /** Turn the active proposals into blur annotations — one undo step. */
  applyRedactions: () => void
  clearRedaction: () => void
  /**
   * Patch an annotation. `commitChange: false` = live update (drag in
   * progress), `true` = final value, pushed to history as one undo step.
   * The pre-interaction snapshot is stashed by beginChange().
   */
  update: (id: string, patch: Partial<Annotation>, commitChange: boolean) => void
  /** Call at dragstart/transformstart to snapshot the pre-change state. */
  beginChange: () => void
  deleteSelected: () => void
  undo: () => void
  redo: () => void
  /** New capture: wipe annotations and history. */
  reset: () => void
}

let pending: Annotation[] | null = null

const patchList = (list: Annotation[], id: string, patch: Partial<Annotation>): Annotation[] =>
  list.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a))

export const useEditorStore = create<EditorState>((set, get) => ({
  history: createHistory<Annotation[]>([]),
  selectedId: null,
  tool: 'select',
  color: '#ef4444',
  strokeWidth: 4,
  highlightWidth: 18,
  fontSize: 24,
  pixelSize: 12,
  redactionStatus: 'idle',
  redactionProgress: 0,
  redactionError: null,
  proposals: [],

  setTool: (tool) => set({ tool, selectedId: null }),
  setColor: (color) => set({ color }),
  setStrokeWidth: (strokeWidth) => set({ strokeWidth }),
  setHighlightWidth: (highlightWidth) => set({ highlightWidth }),
  setFontSize: (fontSize) => set({ fontSize }),
  setPixelSize: (pixelSize) => set({ pixelSize }),
  select: (selectedId) => set({ selectedId }),

  add: (anno) => {
    const h = get().history
    set({ history: commit(h, [...h.present, anno]), selectedId: anno.id })
  },

  addMany: (annos) => {
    if (annos.length === 0) return
    const h = get().history
    set({ history: commit(h, [...h.present, ...annos]) })
  },

  startRedaction: () =>
    set({ redactionStatus: 'running', redactionProgress: 0, redactionError: null, proposals: [] }),
  setRedactionProgress: (redactionProgress) => set({ redactionProgress }),
  setRedactionError: (redactionError) => set({ redactionError, redactionStatus: 'idle' }),
  setProposals: (proposals) => set({ proposals, redactionStatus: 'review' }),
  toggleProposal: (id) =>
    set({
      proposals: get().proposals.map((p) => (p.id === id ? { ...p, active: !p.active } : p))
    }),
  applyRedactions: () => {
    const { proposals, pixelSize, color } = get()
    get().addMany(
      proposals
        .filter((p) => p.active)
        .map((p) => ({
          id: crypto.randomUUID(),
          type: 'blur' as const,
          x: p.x,
          y: p.y,
          width: p.width,
          height: p.height,
          pixelSize,
          color
        }))
    )
    get().clearRedaction()
  },
  clearRedaction: () =>
    set({ redactionStatus: 'idle', redactionProgress: 0, redactionError: null, proposals: [] }),

  update: (id, patch, commitChange) => {
    const h = get().history
    const next = patchList(h.present, id, patch)
    if (commitChange) {
      // One undo step from the stashed pre-interaction state to the final one.
      const base = pending ? { ...h, present: pending } : h
      pending = null
      set({ history: commit(base, next) })
    } else {
      if (!pending) pending = h.present
      set({ history: { ...h, present: next } })
    }
  },

  beginChange: () => {
    pending = get().history.present
  },

  deleteSelected: () => {
    const { history: h, selectedId } = get()
    if (!selectedId) return
    set({
      history: commit(
        h,
        h.present.filter((a) => a.id !== selectedId)
      ),
      selectedId: null
    })
  },

  undo: () => {
    const h = get().history
    if (canUndo(h)) set({ history: undo(h), selectedId: null })
  },
  redo: () => {
    const h = get().history
    if (canRedo(h)) set({ history: redo(h), selectedId: null })
  },

  reset: () => {
    pending = null
    set({
      history: createHistory<Annotation[]>([]),
      selectedId: null,
      tool: 'select',
      redactionStatus: 'idle',
      redactionProgress: 0,
      redactionError: null,
      proposals: []
    })
  }
}))

/** Convenience selectors. */
export const useAnnotations = (): Annotation[] => useEditorStore((s) => s.history.present)
export const useCanUndo = (): boolean => useEditorStore((s) => canUndo(s.history))
export const useCanRedo = (): boolean => useEditorStore((s) => canRedo(s.history))
