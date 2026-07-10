import { useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { useAnnotations, useEditorStore } from '@renderer/stores/editor'
import type { Annotation } from './annotations'

/** Reduced, sensible palette — not 16M colors. */
export const PALETTE = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#3b82f6', // blue
  '#a855f7', // purple
  '#171717', // near-black
  '#ffffff' // white
] as const

function Slider({
  label,
  value,
  min,
  max,
  onChange,
  onCommit
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  /** Fired once when the drag ends — the moment to push ONE history entry. */
  onCommit?: () => void
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex justify-between text-xs text-muted-foreground">
        {label}
        <span className="tabular-nums">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
        className="accent-primary"
      />
    </label>
  )
}

function PropertiesPanel(): React.JSX.Element {
  const annotations = useAnnotations()
  const selectedId = useEditorStore((s) => s.selectedId)
  const store = useEditorStore

  const s = useEditorStore()
  const selected: Annotation | undefined = annotations.find((a) => a.id === selectedId)

  // Contextual: edit the selected annotation, otherwise the defaults for new ones.
  const color = selected?.color ?? s.color
  const setColor = (c: string): void => {
    if (selected) store.getState().update(selected.id, { color: c }, true)
    else s.setColor(c)
  }

  // Sliders update live WITHOUT touching history; one entry lands on release.
  // (Committing every tick made undo step back pixel by pixel.)
  const sliderDirty = useRef<string | null>(null)
  const liveUpdate = (id: string, patch: Partial<Annotation>): void => {
    sliderDirty.current = id
    store.getState().update(id, patch, false)
  }
  const commitSlider = (): void => {
    const id = sliderDirty.current
    if (!id) return
    sliderDirty.current = null
    store.getState().update(id, {}, true)
  }

  const STROKE_TYPES = ['arrow', 'line', 'pen', 'rect'] as const
  const strokeTarget =
    selected && (STROKE_TYPES as readonly string[]).includes(selected.type)
      ? (selected as Extract<
          Annotation,
          { strokeWidth: number; type: (typeof STROKE_TYPES)[number] }
        >)
      : null
  const showStroke =
    strokeTarget !== null || (!selected && (STROKE_TYPES as readonly string[]).includes(s.tool))
  const strokeValue = strokeTarget?.strokeWidth ?? s.strokeWidth

  // Paint-style marker size (its own default, thicker than shape strokes).
  const highlightTarget = selected?.type === 'highlight' ? selected : null
  const showHighlight = highlightTarget !== null || (!selected && s.tool === 'highlight')
  const highlightValue = highlightTarget?.strokeWidth ?? s.highlightWidth

  const textTarget = selected?.type === 'text' ? selected : null
  const showFont = textTarget !== null || (!selected && s.tool === 'text')
  const fontValue = textTarget?.fontSize ?? s.fontSize

  const blurTarget = selected?.type === 'blur' ? selected : null
  const showPixel = blurTarget !== null || (!selected && s.tool === 'blur')
  const pixelValue = blurTarget?.pixelSize ?? s.pixelSize

  return (
    <aside aria-label="Properties" className="flex w-52 flex-col gap-5 border-l bg-card/50 p-3">
      <div className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
        {selected ? selected.type : 'Tool defaults'}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Color</span>
        <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Color">
          {PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              className={cn(
                'size-8 rounded-md border border-foreground/10 transition-shadow outline-none',
                'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                color === c && 'ring-2 ring-ring ring-offset-2 ring-offset-background'
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {showStroke && (
        <Slider
          label="Stroke"
          value={strokeValue}
          min={1}
          max={16}
          onChange={(v) =>
            strokeTarget ? liveUpdate(strokeTarget.id, { strokeWidth: v }) : s.setStrokeWidth(v)
          }
          onCommit={commitSlider}
        />
      )}

      {showHighlight && (
        <Slider
          label="Size"
          value={highlightValue}
          min={6}
          max={48}
          onChange={(v) =>
            highlightTarget
              ? liveUpdate(highlightTarget.id, { strokeWidth: v })
              : s.setHighlightWidth(v)
          }
          onCommit={commitSlider}
        />
      )}

      {showFont && (
        <Slider
          label="Font size"
          value={fontValue}
          min={10}
          max={96}
          onChange={(v) =>
            textTarget ? liveUpdate(textTarget.id, { fontSize: v }) : s.setFontSize(v)
          }
          onCommit={commitSlider}
        />
      )}

      {showPixel && (
        <Slider
          label="Pixel size"
          value={pixelValue}
          min={4}
          max={48}
          onChange={(v) =>
            blurTarget ? liveUpdate(blurTarget.id, { pixelSize: v }) : s.setPixelSize(v)
          }
          onCommit={commitSlider}
        />
      )}

      {selected && (
        <Button variant="destructive" size="sm" onClick={() => store.getState().deleteSelected()}>
          <Trash2 />
          Delete
        </Button>
      )}
    </aside>
  )
}

export default PropertiesPanel
