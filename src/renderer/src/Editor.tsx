import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Camera,
  Copy,
  Download,
  Loader2,
  Redo2,
  Scissors,
  ShieldCheck,
  Sparkles,
  Undo2,
  X
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useCaptureStore } from '@renderer/stores/capture'
import { usePrefsStore } from '@renderer/stores/prefs'
import { useCanRedo, useCanUndo, useEditorStore } from '@renderer/stores/editor'
import { dragRegion, noDrag } from '@renderer/lib/titlebar'
import EditorCanvas from './editor/EditorCanvas'
import Toolbar from './editor/Toolbar'
import { TOOLS } from './editor/tools'
import PropertiesPanel from './editor/PropertiesPanel'
import RedactionBar from './editor/RedactionBar'
import { runAutoRedaction } from './editor/redact'
import { composeWithBackground, templateGradient } from './editor/exporter'
import { extractSubject } from './editor/subject'

function Editor(): React.JSX.Element {
  const image = useCaptureStore((s) => s.image)
  const clearCapture = useCaptureStore((s) => s.clear)
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()
  const redactionStatus = useEditorStore((s) => s.redactionStatus)
  const store = useEditorStore

  const exportRef = useRef<(() => string | null) | null>(null)

  // Toast lives in the store so canvas tools (lasso/smart-cut) can notify too.
  const toast = useEditorStore((s) => s.toast)
  const toastNonce = useEditorStore((s) => s.toastNonce)
  const showToast = useCallback((message: string): void => {
    useEditorStore.getState().showToast(message)
  }, [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => useEditorStore.getState().clearToast(), 2500)
    return () => clearTimeout(t)
  }, [toast, toastNonce])

  const doCopy = useCallback(async (): Promise<void> => {
    const url = exportRef.current?.()
    if (!url) return
    await window.api.exportCopy(url)
    showToast('Copied to clipboard')
  }, [showToast])

  const doCopyStyled = useCallback(async (): Promise<void> => {
    const url = exportRef.current?.()
    if (!url) return
    const template = usePrefsStore.getState().prefs?.styledTemplate ?? 'indigo'
    const styled = await composeWithBackground(url, { gradient: templateGradient(template) })
    await window.api.exportCopy(styled)
    showToast('Copied with background')
  }, [showToast])

  const [extracting, setExtracting] = useState(false)
  const doCopySubject = useCallback(async (): Promise<void> => {
    const src = useCaptureStore.getState().image?.dataUrl
    if (!src || extracting) return
    setExtracting(true)
    try {
      const subject = await extractSubject(src)
      await window.api.exportCopy(subject)
      showToast('Subject copied — paste it as a sticker')
    } catch (err) {
      console.error('[subject]', err)
      showToast('Subject extraction failed — see console')
    } finally {
      setExtracting(false)
    }
  }, [extracting, showToast])

  const doSave = useCallback(async (): Promise<void> => {
    const url = exportRef.current?.()
    if (!url) return
    const result = await window.api.exportSave(url)
    if (result.status === 'saved') showToast(`Saved to ${result.path}`)
    else if (result.status === 'error') showToast(`Save failed: ${result.message}`)
  }, [showToast])

  // New capture → fresh annotations and history; optionally auto-scan.
  useEffect(() => {
    store.getState().reset()
    if (image && usePrefsStore.getState().prefs?.autoRedactOnCapture) {
      void runAutoRedaction(image.dataUrl)
    }
  }, [image, image?.dataUrl, store])

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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        void (e.shiftKey ? doCopyStyled() : doCopy())
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void doSave()
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
  }, [store, doCopy, doCopyStyled, doSave])

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
          <div className="mx-1 h-5 w-px bg-border" />
          <Button variant="ghost" size="sm" title="Copy — ⌘C" onClick={() => void doCopy()}>
            <Copy />
            Copy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            title="Copy with padded background — ⇧⌘C"
            onClick={() => void doCopyStyled()}
          >
            <Sparkles />
            Styled
          </Button>
          <Button
            variant="ghost"
            size="sm"
            title="Copy only the subject, background removed (runs locally)"
            disabled={extracting}
            onClick={() => void doCopySubject()}
          >
            {extracting ? <Loader2 className="animate-spin" /> : <Scissors />}
            Subject
          </Button>
          <Button variant="ghost" size="sm" title="Save to file — ⌘S" onClick={() => void doSave()}>
            <Download />
            Save
          </Button>
          <div className="mx-1 h-5 w-px bg-border" />
          <Button
            variant="ghost"
            size="icon"
            aria-label="New capture"
            title="New capture"
            onClick={() => window.api.startCapture()}
          >
            <Camera className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Close capture" onClick={clearCapture}>
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Toolbar />
        <main className="relative min-w-0 flex-1 bg-muted/30">
          <EditorCanvas capture={image} exportRef={exportRef} />
          <RedactionBar />
          {toast && (
            <div
              role="status"
              className="absolute right-4 top-4 z-20 max-w-sm truncate rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
            >
              {toast}
            </div>
          )}
        </main>
        <PropertiesPanel />
      </div>
    </div>
  )
}

export default Editor
