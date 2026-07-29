import { useEffect, useRef } from 'react'
import Konva from 'konva'
import { Arrow, Circle, Group, Image as KImage, Line, Rect, Text } from 'react-konva'
import type { Annotation } from './annotations'

export interface NodeProps {
  anno: Annotation
  /** 1-based number, only meaningful for step markers. */
  stepNo: number
  /** Background screenshot, needed by blur nodes. */
  image: HTMLImageElement
  /** Whether the select tool is active (nodes become interactive). */
  interactive: boolean
  selected: boolean
  onSelect: () => void
  onBeginChange: () => void
  onChange: (patch: Partial<Annotation>, commit: boolean) => void
  onEditText?: () => void
}

const FONT_FAMILY = 'Helvetica Neue, Helvetica, Arial, sans-serif'

// Hover feedback with the select tool: annotations are movable, say so.
// Only fires when the node is listening (i.e. select tool active).
const hoverCursor = {
  onMouseEnter: (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage()
    if (stage) stage.container().style.cursor = 'move'
  },
  onMouseLeave: (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage()
    if (stage) stage.container().style.cursor = 'default'
  }
}

function BlurNode({
  anno,
  image,
  common
}: {
  anno: Extract<Annotation, { type: 'blur' }>
  image: HTMLImageElement
  common: Record<string, unknown>
}): React.JSX.Element {
  const ref = useRef<Konva.Image>(null)

  // Pixelate filter needs the node cached; re-cache when geometry changes.
  useEffect(() => {
    ref.current?.cache()
  }, [anno.x, anno.y, anno.width, anno.height, anno.pixelSize, image])

  return (
    <KImage
      {...common}
      ref={ref}
      image={image}
      x={anno.x}
      y={anno.y}
      width={anno.width}
      height={anno.height}
      crop={{ x: anno.x, y: anno.y, width: anno.width, height: anno.height }}
      filters={[Konva.Filters.Pixelate]}
      pixelSize={anno.pixelSize}
      stroke="rgba(255,255,255,0.35)"
      strokeWidth={1}
    />
  )
}

function AnnotationNode({
  anno,
  stepNo,
  image,
  interactive,
  selected,
  onSelect,
  onBeginChange,
  onChange,
  onEditText
}: NodeProps): React.JSX.Element | null {
  // Shared interaction props. Position-based shapes commit drag moves here;
  // resize (Transformer) is handled by the canvas.
  const common = {
    id: anno.id,
    draggable: interactive,
    listening: interactive,
    onMouseDown: onSelect,
    onTap: onSelect,
    onDragStart: onBeginChange,
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) =>
      onChange({ x: e.target.x(), y: e.target.y() }, true),
    ...hoverCursor
  }

  switch (anno.type) {
    case 'arrow':
    case 'line': {
      // Arrows/lines drag via their points, not x/y offset: translate on drag end.
      const [x1, y1, x2, y2] = anno.points
      return (
        <Group
          id={anno.id}
          draggable={interactive}
          listening={interactive}
          onMouseDown={onSelect}
          onTap={onSelect}
          onDragStart={onBeginChange}
          onDragEnd={(e) => {
            const dx = e.target.x()
            const dy = e.target.y()
            e.target.position({ x: 0, y: 0 })
            onChange({ points: [x1 + dx, y1 + dy, x2 + dx, y2 + dy] }, true)
          }}
          {...hoverCursor}
        >
          {anno.type === 'arrow' ? (
            <Arrow
              points={[x1, y1, x2, y2]}
              stroke={anno.color}
              fill={anno.color}
              strokeWidth={anno.strokeWidth}
              pointerLength={anno.strokeWidth * 3.5}
              pointerWidth={anno.strokeWidth * 3}
              hitStrokeWidth={Math.max(16, anno.strokeWidth * 3)}
              lineCap="round"
            />
          ) : (
            <Line
              points={[x1, y1, x2, y2]}
              stroke={anno.color}
              strokeWidth={anno.strokeWidth}
              hitStrokeWidth={Math.max(16, anno.strokeWidth * 3)}
              lineCap="round"
            />
          )}
          {selected && (
            <>
              {(
                [
                  [x1, y1, 0],
                  [x2, y2, 2]
                ] as const
              ).map(([px, py, idx]) => (
                <Circle
                  key={idx}
                  x={px}
                  y={py}
                  radius={6}
                  fill="#ffffff"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                  draggable
                  onDragStart={onBeginChange}
                  onDragMove={(e) => {
                    const p: [number, number, number, number] = [x1, y1, x2, y2]
                    p[idx] = e.target.x()
                    p[idx + 1] = e.target.y()
                    onChange({ points: p }, false)
                  }}
                  onDragEnd={(e) => {
                    const p: [number, number, number, number] = [x1, y1, x2, y2]
                    p[idx] = e.target.x()
                    p[idx + 1] = e.target.y()
                    onChange({ points: p }, true)
                  }}
                />
              ))}
            </>
          )}
        </Group>
      )
    }

    case 'rect':
      return (
        <Rect
          {...common}
          x={anno.x}
          y={anno.y}
          width={anno.width}
          height={anno.height}
          stroke={anno.color}
          strokeWidth={anno.strokeWidth}
          cornerRadius={2}
        />
      )

    case 'highlight':
    case 'pen':
      // Paint-style freehand strokes. Highlight is translucent multiply
      // (marker), pen is opaque ink. Drags via node offset, then bakes the
      // translation back into the points (same trick as arrows).
      return (
        <Line
          id={anno.id}
          draggable={interactive}
          listening={interactive}
          onMouseDown={onSelect}
          onTap={onSelect}
          onDragStart={onBeginChange}
          onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
            const dx = e.target.x()
            const dy = e.target.y()
            e.target.position({ x: 0, y: 0 })
            onChange({ points: anno.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)) }, true)
          }}
          points={anno.points}
          stroke={anno.color}
          strokeWidth={anno.strokeWidth}
          opacity={anno.type === 'highlight' ? 0.4 : 1}
          globalCompositeOperation={anno.type === 'highlight' ? 'multiply' : 'source-over'}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={anno.strokeWidth + 10}
          shadowForStrokeEnabled={false}
          {...hoverCursor}
        />
      )

    case 'text':
      return (
        <Text
          {...common}
          x={anno.x}
          y={anno.y}
          text={anno.text}
          fontSize={anno.fontSize}
          fontFamily={FONT_FAMILY}
          fontStyle="bold"
          fill={anno.color}
          onDblClick={onEditText}
          onDblTap={onEditText}
        />
      )

    case 'step':
      return (
        <Group {...common} x={anno.x} y={anno.y}>
          <Circle
            radius={anno.size}
            fill={anno.color}
            stroke="#ffffff"
            strokeWidth={2}
            shadowColor="rgba(0,0,0,0.4)"
            shadowBlur={4}
            shadowOffsetY={1}
          />
          <Text
            text={String(stepNo)}
            fontSize={anno.size}
            fontStyle="bold"
            fontFamily={FONT_FAMILY}
            fill="#ffffff"
            width={anno.size * 2}
            height={anno.size * 2}
            offsetX={anno.size}
            offsetY={anno.size}
            align="center"
            verticalAlign="middle"
            listening={false}
          />
        </Group>
      )

    case 'blur':
      return <BlurNode anno={anno} image={image} common={common} />

    default:
      return null
  }
}

export default AnnotationNode
