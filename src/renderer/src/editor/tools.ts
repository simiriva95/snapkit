import {
  EyeOff,
  Highlighter,
  Lasso,
  ListOrdered,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Slash,
  Square,
  Type,
  WandSparkles,
  type LucideIcon
} from 'lucide-react'
import type { Tool } from './annotations'

export const TOOLS: { tool: Tool; icon: LucideIcon; label: string; key: string }[] = [
  { tool: 'select', icon: MousePointer2, label: 'Select', key: 'V' },
  { tool: 'arrow', icon: MoveUpRight, label: 'Arrow', key: 'A' },
  { tool: 'line', icon: Slash, label: 'Line', key: 'L' },
  { tool: 'pen', icon: Pencil, label: 'Pen (freehand)', key: 'P' },
  { tool: 'rect', icon: Square, label: 'Rectangle', key: 'R' },
  { tool: 'text', icon: Type, label: 'Text', key: 'T' },
  { tool: 'highlight', icon: Highlighter, label: 'Highlighter', key: 'H' },
  { tool: 'step', icon: ListOrdered, label: 'Step marker', key: 'S' },
  { tool: 'blur', icon: EyeOff, label: 'Blur', key: 'B' },
  { tool: 'lasso', icon: Lasso, label: 'Lasso — copy selection', key: 'O' },
  { tool: 'smartcut', icon: WandSparkles, label: 'Smart cut — copy subject in selection', key: 'W' }
]
