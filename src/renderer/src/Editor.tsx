import { useEffect } from 'react'
import { Camera, Redo2, ShieldCheck, Undo2, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useCaptureStore } from '@renderer/stores/capture'
import { useCanRedo, useCanUndo, useEditorStore } from '@renderer/stores/editor'
import { dragRegion, noDrag } from '@renderer/lib/titlebar'
import EditorCanvas from './editor/EditorCanvas'
import Toolbar from './editor/Toolbar'
import { TOOLS } from './editor/tools'
import PropertiesPanel from './editor/PropertiesPanel'
import RedactionBar from './editor/RedactionBar'
import { runAutoRedaction } from './editor/redact'

function Editor(): React.JSX.Element {
  const image = useCaptureStore((s) => s.image)
  const clearCapture = useCaptureStore((s) => s.clear)
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()
  const redactionStatus = useEditorStore((s) => s.redactionStatus)
  const store = useEditorStore

  // New capture → fresh annotations and history.
  useEffect(() => {
    store.getState().reset()
  }, [image?.dataUrl, store])

  // Editor keyboard shortcuts. Text inputs stopPropagation, so no conflicts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return
      const s = store.getState()

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        s.deleteSelected()
        return
      }
      if (e.key === 'Escape') {
        s.select(null)
        return
      }
      const hit = TOOLS.find((tl) => tl.key.toLowerCase() === e.key.toLowerCase())
      if (hit && !e.metaKey && !e.ctrlKey && !e.altKey) s.setTool(hit.tool)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  if (!image) return <></>

  return (
    <div className="flex h-full flex-col">
      <header
        style={dragRegion}
        className="flex h-11 shrink-0 items-center justify-between border-b px-3 pl-20"
      >
        <span className="text-xs font-medium tabular-nums text-muted-foreground">
          Capture · {image.width} × {image.height}
        </span>
        <div style={noDrag} className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={() => store.getState().undo()}
          >
            <Undo2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Redo"
            disabled={!canRedo}
            onClick={() => store.getState().redo()}
          >
            <Redo2 className="size-4" />
          </Button>
          <div className="mx-1 h-5 w-px bg-border" />
          <Button
            variant="ghost"
            size="sm"
            disabled={redactionStatus === 'running'}
            onClick={() => void runAutoRedaction(image.dataUrl)}
          >
            <ShieldCheck />
            Auto-redact
          </Button>
          <Button variant="ghost" size="sm" onClick={() => window.api.startCapture()}>
            <Camera />
            New capture
          </Button>
          <Button variant="ghost" size="icon" aria-label="Close capture" onClick={clearCapture}>
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Toolbar />
        <main className="relative min-w-0 flex-1 bg-muted/30">
          <EditorCanvas capture={image} />
          <RedactionBar />
        </main>
        <PropertiesPanel />
      </div>
    </div>
  )
}

export default Editor
