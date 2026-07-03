/**
 * Pure, generic undo/redo history. Snapshot-based: each committed change
 * stores the full state. States must be treated as immutable.
 */

export interface History<T> {
  past: T[]
  present: T
  future: T[]
}

export const HISTORY_CAP = 100

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

/** Commit a new state. Clears the redo branch (standard linear history). */
export function commit<T>(h: History<T>, next: T, cap: number = HISTORY_CAP): History<T> {
  return {
    past: [...h.past, h.present].slice(-cap),
    present: next,
    future: []
  }
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h
  return {
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1],
    future: [h.present, ...h.future]
  }
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h
  return {
    past: [...h.past, h.present],
    present: h.future[0],
    future: h.future.slice(1)
  }
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0
export const canRedo = <T>(h: History<T>): boolean => h.future.length > 0
