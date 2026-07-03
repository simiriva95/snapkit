import { useEffect, useState, type CSSProperties } from 'react'
import { Camera, Minus, ShieldCheck } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'

// Frameless window: this strip is the OS drag handle; interactive controls opt out.
const dragRegion: CSSProperties = { WebkitAppRegion: 'drag' } as CSSProperties
const noDrag: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties

function App(): React.JSX.Element {
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.api.getVersion().then(setVersion).catch(console.error)
  }, [])

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

        <Button disabled style={noDrag}>
          <Camera />
          New capture — coming in M1
        </Button>

        {version && (
          <span className="text-xs text-muted-foreground/60">v{version} · Milestone 0</span>
        )}
      </main>
    </div>
  )
}

export default App
