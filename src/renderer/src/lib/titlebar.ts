import type { CSSProperties } from 'react'

// Frameless window: the header strip is the OS drag handle; interactive
// controls opt out with noDrag.
export const dragRegion: CSSProperties = { WebkitAppRegion: 'drag' } as CSSProperties
export const noDrag: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties

/** Human hint for the capture shortcut, per platform. */
export const captureShortcutLabel = navigator.platform.startsWith('Mac') ? '⌘⇧2' : 'Ctrl+Shift+2'
