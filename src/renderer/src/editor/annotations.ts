/**
 * Annotation model. Plain serializable objects (JSON round-trip safe) — this
 * is what the undo/redo history snapshots and what a future "save project"
 * would persist. Coordinates are in image pixels.
 */

export type Tool =
  | 'select'
  | 'arrow'
  | 'line'
  | 'pen'
  | 'rect'
  | 'text'
  | 'highlight'
  | 'step'
  | 'blur'
  // Action tools — they drive an interaction but never create an annotation.
  | 'lasso'
  | 'smartcut'

interface Base {
  id: string
  color: string
}

export interface ArrowAnno extends Base {
  type: 'arrow'
  /** [x1, y1, x2, y2] */
  points: [number, number, number, number]
  strokeWidth: number
}

export interface LineAnno extends Base {
  type: 'line'
  /** [x1, y1, x2, y2] */
  points: [number, number, number, number]
  strokeWidth: number
}

export interface PenAnno extends Base {
  type: 'pen'
  /** Freehand stroke: [x1, y1, x2, y2, ...]. Opaque, unlike highlight. */
  points: number[]
  strokeWidth: number
}

export interface RectAnno extends Base {
  type: 'rect'
  x: number
  y: number
  width: number
  height: number
  strokeWidth: number
}

export interface TextAnno extends Base {
  type: 'text'
  x: number
  y: number
  text: string
  fontSize: number
}

export interface HighlightAnno extends Base {
  type: 'highlight'
  /** Freehand marker stroke: [x1, y1, x2, y2, ...]. Paint-style. */
  points: number[]
  strokeWidth: number
}

export interface StepAnno extends Base {
  type: 'step'
  x: number
  y: number
  size: number
}

export interface BlurAnno extends Base {
  type: 'blur'
  x: number
  y: number
  width: number
  height: number
  pixelSize: number
}

export type Annotation =
  ArrowAnno | LineAnno | PenAnno | RectAnno | TextAnno | HighlightAnno | StepAnno | BlurAnno

/** 1-based number of a step marker, derived from creation order (no renumbering needed). */
export function stepNumber(annotations: Annotation[], id: string): number {
  return annotations.filter((a) => a.type === 'step').findIndex((a) => a.id === id) + 1
}

/** Normalize a drag rectangle (any direction) to positive width/height. */
export function normalizeRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  }
}
