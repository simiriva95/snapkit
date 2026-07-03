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
          className="absolute border border-white/90"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            // Dim everything around the selection without extra elements.
            boxShadow: '0 0 0 100000px rgba(0, 0, 0, 0.45)'
          }}
        >
          <span className="absolute -bottom-7 left-0 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
            {rect.width} × {rect.height}
          </span>
        </div>
      ) : (
        <div className="absolute inset-0 bg-black/45" />
      )}

      {!start && (
        <div className="absolute left-1/2 top-8 -translate-x-1/2 rounded-md bg-black/70 px-3 py-1.5 text-xs text-white/90">
          Drag to select an area — Esc to cancel
        </div>
      )}
    </div>
  )
}

export default Overlay
