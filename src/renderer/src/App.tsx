import { useEffect, useState } from 'react'
import { Camera, Minus, ShieldCheck } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useCaptureStore } from '@renderer/stores/capture'
import { dragRegion, noDrag, captureShortcutLabel } from '@renderer/lib/titlebar'
import Editor from './Editor'

function App(): React.JSX.Element {
  const [version, setVersion] = useState('')
  const image = useCaptureStore((s) => s.image)

  useEffect(() => {
    window.api.getVersion().then(setVersion).catch(console.error)
  }, [])

  useEffect(
    () => window.api.onCapture((payload) => useCaptureStore.getState().setImage(payload)),
    []
  )

  if (image) return <Editor />

  return (
    <div className="flex h-full flex-col">
      <header
        style={dragRegion}
        className="flex h-11 shrink-0 items-center justify-between px-3 pl-20"
      >
        <span className="text-xs font-medium text-muted-foreground">Snapkit</span>
        <button
          style={noDrag}
          onClick={() => window.api.hideWindow()}
          aria-label="Hide window"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Minus className="size-4" />
        </button>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-8 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Camera className="size-8" />
        </div>

        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Snapkit</h1>
          <p className="text-sm text-muted-foreground">Capture. Redact. Ship — safely.</p>
        </div>

        <div className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          Your screenshots never leave this device
        </div>

        <Button style={noDrag} onClick={() => window.api.startCapture()}>
          <Camera />
          Capture area
          <kbd className="rounded bg-primary-foreground/15 px-1.5 py-0.5 text-[11px] font-normal">
            {captureShortcutLabel}
          </kbd>
        </Button>

        {version && (
          <span className="text-xs text-muted-foreground/60">v{version} · Milestone 1</span>
        )}
      </main>
    </div>
  )
}

export default App
