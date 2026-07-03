import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import Konva from 'konva'
import { Image as KImage, Layer, Stage, Transformer } from 'react-konva'
import type { CapturePayload } from '@shared/ipc'
import { useEditorStore, useAnnotations } from '@renderer/stores/editor'
import { normalizeRect, stepNumber, type Annotation } from './annotations'
import AnnotationNode from './AnnotationNode'
import TextEditOverlay from './TextEditOverlay'
import RedactionLayer from './RedactionLayer'

const MIN_DRAG = 3 // px in image coords — smaller drags are accidental clicks

function useHtmlImage(src: string): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    const el = new window.Image()
    el.onload = () => setImg(el)
    el.src = src
    return () => {
      el.onload = null
    }
  }, [src])
  return img
}

interface EditorCanvasProps {
  capture: CapturePayload
  /** Imperative hook the header buttons use to pull a clean full-res PNG. */
  exportRef: RefObject<(() => string | null) | null>
}

function EditorCanvas({ capture, exportRef }: EditorCanvasProps): React.JSX.Element {
  const image = useHtmlImage(capture.dataUrl)
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const [scale, setScale] = useState(1)
  const [draft, setDraft] = useState<Annotation | null>(null)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const annotations = useAnnotations()
  const tool = useEditorStore((s) => s.tool)
  const selectedId = useEditorStore((s) => s.selectedId)
  const store = useEditorStore

  const imgW = image?.naturalWidth ?? 1
  const imgH = image?.naturalHeight ?? 1

  // Fit-to-window scale (never upscale past 100%).
  const refit = useCallback((): void => {
    const el = containerRef.current
    if (!el || !image) return
    const pad = 32
    const s = Math.min((el.clientWidth - pad) / imgW, (el.clientHeight - pad) / imgH, 1)
    setScale(Math.max(s, 0.05))
  }, [image, imgW, imgH])

  useLayoutEffect(() => {
    refit()
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(refit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [refit])

  // Attach the transformer to the selected resizable node.
  useEffect(() => {
    const tr = trRef.current
    const stage = stageRef.current
    if (!tr || !stage) return
    const anno = annotations.find((a) => a.id === selectedId)
    const resizable = anno && (anno.type === 'rect' || anno.type === 'blur')
    if (resizable && tool === 'select') {
      const node = stage.findOne(`#${selectedId}`)
      if (node) {
        tr.nodes([node])
        tr.getLayer()?.batchDraw()
        return
      }
    }
    tr.nodes([])
  }, [selectedId, annotations, tool, scale])

  // Header export: strip selection chrome + proposals, snapshot at full res
  // (pixelRatio compensates the fit scale), then restore the UI.
  useEffect(() => {
    exportRef.current = () => {
      const stage = stageRef.current
      if (!stage) return null
      flushSync(() => {
        store.getState().select(null)
        setExporting(true)
      })
      trRef.current?.nodes([])
      stage.draw()
      const url = stage.toDataURL({ pixelRatio: 1 / scale, mimeType: 'image/png' })
      flushSync(() => setExporting(false))
      return url
    }
    return () => {
      exportRef.current = null
    }
  }, [exportRef, scale, store])

  const pointer = (): { x: number; y: number } | null => {
    const p = stageRef.current?.getPointerPosition()
    return p ? { x: p.x / scale, y: p.y / scale } : null
  }

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>): void => {
    const s = store.getState()
    const pos = pointer()
    if (!pos) return
    const onEmpty = e.target === e.target.getStage() || e.target.name() === 'background'

    if (tool === 'select') {
      if (onEmpty) s.select(null)
      return
    }
    if (!onEmpty && tool !== 'blur') return // draw tools only start on empty space

    const id = crypto.randomUUID()
    switch (tool) {
      case 'arrow':
        setDraft({
          id,
          type: 'arrow',
          points: [pos.x, pos.y, pos.x, pos.y],
          color: s.color,
          strokeWidth: s.strokeWidth
        })
        break
      case 'rect':
        setDraft({
          id,
          type: 'rect',
          x: pos.x,
          y: pos.y,
          width: 0,
          height: 0,
          color: s.color,
          strokeWidth: s.strokeWidth
        })
        break
      case 'highlight':
        setDraft({
          id,
          type: 'highlight',
          points: [pos.x, pos.y],
          strokeWidth: s.highlightWidth,
          color: s.color
        })
        break
      case 'blur':
        setDraft({
          id,
          type: 'blur',
          x: pos.x,
          y: pos.y,
          width: 0,
          height: 0,
          pixelSize: s.pixelSize,
          color: s.color
        })
        break
      case 'step':
        s.add({ id, type: 'step', x: pos.x, y: pos.y, size: 14, color: s.color })
        break
      case 'text': {
        // Stop the native mousedown from moving focus: the edit textarea we
        // are about to mount must keep it, or blur-commit kills the empty
        // annotation instantly.
        e.evt.preventDefault()
        const anno: Annotation = {
          id,
          type: 'text',
          x: pos.x,
          y: pos.y,
          text: '',
          fontSize: s.fontSize,
          color: s.color
        }
        s.add(anno)
        setEditingTextId(id)
        break
      }
    }
  }

  const onMouseMove = (): void => {
    if (!draft) return
    const pos = pointer()
    if (!pos) return
    if (draft.type === 'arrow') {
      setDraft({ ...draft, points: [draft.points[0], draft.points[1], pos.x, pos.y] })
    } else if (draft.type === 'highlight') {
      // Freehand: append the pointer trail.
      setDraft({ ...draft, points: [...draft.points, pos.x, pos.y] })
    } else if ('width' in draft) {
      // rect/blur share the drag-a-rectangle interaction. The draft keeps its
      // origin corner; normalize on commit.
      setDraft({ ...draft, width: pos.x - draft.x, height: pos.y - draft.y })
    }
  }

  const onMouseUp = (): void => {
    if (!draft) return
    setDraft(null)
    const s = store.getState()
    if (draft.type === 'arrow') {
      const [x1, y1, x2, y2] = draft.points
      if (Math.hypot(x2 - x1, y2 - y1) >= MIN_DRAG) s.add(draft)
      return
    }
    if (draft.type === 'highlight') {
      if (draft.points.length >= 4) s.add(draft)
      return
    }
    if ('width' in draft) {
      const r = normalizeRect(draft.x, draft.y, draft.x + draft.width, draft.y + draft.height)
      if (r.width >= MIN_DRAG && r.height >= MIN_DRAG) s.add({ ...draft, ...r })
    }
  }

  const onTransformEnd = (): void => {
    const tr = trRef.current
    const node = tr?.nodes()[0]
    const id = node?.id()
    if (!node || !id) return
    const scaleX = node.scaleX()
    const scaleY = node.scaleY()
    node.scale({ x: 1, y: 1 })
    store.getState().update(
      id,
      {
        x: node.x(),
        y: node.y(),
        width: Math.max(4, node.width() * scaleX),
        height: Math.max(4, node.height() * scaleY)
      },
      true
    )
  }

  const editingText = annotations.find((a) => a.id === editingTextId && a.type === 'text')

  const cursor = tool === 'select' ? 'default' : 'crosshair'

  if (!image) {
    return <div ref={containerRef} className="flex h-full w-full items-center justify-center" />
  }

  return (
    <div
      ref={containerRef}
      className="flex h-full w-full items-center justify-center overflow-hidden"
    >
      <div className="relative shadow-lg" style={{ width: imgW * scale, height: imgH * scale }}>
        <Stage
          ref={stageRef}
          width={imgW * scale}
          height={imgH * scale}
          scaleX={scale}
          scaleY={scale}
          style={{ cursor }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
        >
          <Layer>
            <KImage image={image} name="background" listening={true} />
          </Layer>
          <Layer>
            {annotations.map((anno) => (
              <AnnotationNode
                key={anno.id}
                anno={anno}
                stepNo={anno.type === 'step' ? stepNumber(annotations, anno.id) : 0}
                image={image}
                interactive={tool === 'select'}
                selected={selectedId === anno.id}
                onSelect={() => store.getState().select(anno.id)}
                onBeginChange={() => store.getState().beginChange()}
                onChange={(patch, commit) => store.getState().update(anno.id, patch, commit)}
                onEditText={() => setEditingTextId(anno.id)}
              />
            ))}
            {draft &&
              // Blur caches a Konva node; skip until it has real size.
              !(
                draft.type === 'blur' &&
                (Math.abs(draft.width) < 2 || Math.abs(draft.height) < 2)
              ) && (
                <AnnotationNode
                  anno={
                    'width' in draft
                      ? ({
                          ...draft,
                          ...normalizeRect(
                            draft.x,
                            draft.y,
                            draft.x + draft.width,
                            draft.y + draft.height
                          )
                        } as Annotation)
                      : draft
                  }
                  stepNo={0}
                  image={image}
                  interactive={false}
                  selected={false}
                  onSelect={() => {}}
                  onBeginChange={() => {}}
                  onChange={() => {}}
                />
              )}
            <Transformer
              ref={trRef}
              rotateEnabled={false}
              flipEnabled={false}
              ignoreStroke
              onTransformEnd={onTransformEnd}
              boundBoxFunc={(oldBox, newBox) =>
                newBox.width < 4 || newBox.height < 4 ? oldBox : newBox
              }
            />
            {!exporting && <RedactionLayer />}
          </Layer>
        </Stage>

        {editingText && editingText.type === 'text' && (
          <TextEditOverlay
            anno={editingText}
            scale={scale}
            onCommit={(text) => {
              const s = store.getState()
              if (text.trim() === '') {
                s.select(editingText.id)
                s.deleteSelected()
              } else {
                s.update(editingText.id, { text }, true)
              }
              setEditingTextId(null)
            }}
            onCancel={() => {
              const s = store.getState()
              if (editingText.text.trim() === '') {
                s.select(editingText.id)
                s.deleteSelected()
              }
              setEditingTextId(null)
            }}
          />
        )}
      </div>
    </div>
  )
}

export default EditorCanvas
