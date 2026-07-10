import { useEffect, useState } from 'react'
import type { Rect } from '@shared/ipc'

interface Point {
  x: number
  y: number
}

function normalize(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  }
}

const MIN_SELECTION = 4 // px — anything smaller is treated as an accidental click

function Overlay(): React.JSX.Element {
  const [bg, setBg] = useState<string | null>(null)
  const [start, setStart] = useState<Point | null>(null)
  const [current, setCurrent] = useState<Point | null>(null)

  useEffect(() => window.overlayApi.onInit((p) => setBg(p.dataUrl)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.overlayApi.cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const rect = start && current ? normalize(start, current) : null

  const onMouseUp = (): void => {
    if (rect && rect.width >= MIN_SELECTION && rect.height >= MIN_SELECTION) {
      window.overlayApi.select(rect)
    } else {
      window.overlayApi.cancel() // plain click = abort, like most capture tools
    }
  }

  return (
    <div
      className="fixed inset-0 cursor-crosshair overflow-hidden"
      onMouseDown={(e) => {
        setStart({ x: e.clientX, y: e.clientY })
        setCurrent({ x: e.clientX, y: e.clientY })
      }}
      onMouseMove={(e) => start && setCurrent({ x: e.clientX, y: e.clientY })}
      onMouseUp={onMouseUp}
    >
      {bg && (
        <img
          src={bg}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full select-none"
        />
      )}

      {rect ? (
        <div
          className="absolute"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            // Signal-amber selection edge + dim veil around it.
            border: '1.5px solid oklch(0.78 0.15 65)',
            boxShadow: '0 0 0 100000px rgba(12, 10, 6, 0.45)'
          }}
        >
          <span className="absolute -bottom-7 left-0 rounded bg-black/85 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-[oklch(0.85_0.1_70)]">
            {rect.width}×{rect.height}
          </span>
        </div>
      ) : (
        <div className="absolute inset-0 bg-black/45" />
      )}

      {!start && (
        <div className="absolute left-1/2 top-8 -translate-x-1/2 rounded-md border border-white/10 bg-black/75 px-3 py-1.5 text-xs text-white/85">
          Drag to select an area — <kbd className="text-white/60">Esc</kbd> to cancel
        </div>
      )}
    </div>
  )
}

export default Overlay
