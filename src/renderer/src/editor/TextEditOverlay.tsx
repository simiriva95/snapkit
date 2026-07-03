import { useEffect, useRef } from 'react'
import type { TextAnno } from './annotations'

interface Props {
  anno: TextAnno
  scale: number
  onCommit: (text: string) => void
  onCancel: () => void
}

/**
 * Absolute-positioned textarea over the Konva stage — the standard pattern
 * for editing Konva.Text (canvas has no native text input).
 */
function TextEditOverlay({ anno, scale, onCommit, onCancel }: Props): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // Deferred: grab focus AFTER the native mousedown default action has run,
    // otherwise the canvas steals it back and blur-commit fires immediately.
    const t = setTimeout(() => {
      ref.current?.focus()
      ref.current?.select()
    }, 0)
    return () => clearTimeout(t)
  }, [])

  const commit = (): void => onCommit(ref.current?.value ?? '')

  return (
    <textarea
      ref={ref}
      defaultValue={anno.text}
      spellCheck={false}
      aria-label="Annotation text"
      className="absolute z-10 resize-none overflow-hidden border border-dashed border-white/60 bg-black/40 p-0 font-bold outline-none"
      style={{
        left: anno.x * scale,
        top: anno.y * scale,
        minWidth: 120 * scale,
        color: anno.color,
        fontSize: anno.fontSize * scale,
        lineHeight: 1.1,
        fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif'
      }}
      rows={1}
      onInput={(e) => {
        // Grow with content.
        const el = e.currentTarget
        el.style.height = 'auto'
        el.style.height = `${el.scrollHeight}px`
        el.style.width = 'auto'
        el.style.width = `${Math.max(el.scrollWidth, 120 * scale)}px`
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation() // don't trigger editor shortcuts while typing
        if (e.key === 'Escape') onCancel()
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit()
      }}
    />
  )
}

export default TextEditOverlay
