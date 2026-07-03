import { Camera, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useCaptureStore } from '@renderer/stores/capture'
import { dragRegion, noDrag } from '@renderer/lib/titlebar'

/**
 * M1 editor: shows the captured image. M2 replaces the <img> with the Konva
 * annotation canvas — header/layout stay.
 */
function Editor(): React.JSX.Element {
  const image = useCaptureStore((s) => s.image)
  const clear = useCaptureStore((s) => s.clear)
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
          <Button variant="ghost" size="sm" onClick={() => window.api.startCapture()}>
            <Camera />
            New capture
          </Button>
          <Button variant="ghost" size="icon" aria-label="Close capture" onClick={clear}>
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center overflow-hidden bg-muted/30 p-6">
        <img
          src={image.dataUrl}
          alt="Captured screenshot"
          draggable={false}
          className="max-h-full max-w-full rounded-md border shadow-lg"
        />
      </main>
    </div>
  )
}

export default Editor
