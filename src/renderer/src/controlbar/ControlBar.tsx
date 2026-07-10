import { useEffect, useState } from 'react'
import { Check, Square, X } from 'lucide-react'
import type { ControlMode } from '@shared/ipc'
import { cn } from '@renderer/lib/utils'

/** Floating session bar: scroll = frames + Done; record = REC timer + Stop. */
function ControlBar(): React.JSX.Element {
  const [mode, setMode] = useState<ControlMode>('scroll')
  const [status, setStatus] = useState('')

  useEffect(() => window.controlApi.onInit((p) => setMode(p.mode)), [])
  useEffect(() => window.controlApi.onStatus((p) => setStatus(p.text)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.controlApi.action('cancel')
      if (e.key === 'Enter') window.controlApi.action('done')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-screen w-screen items-center gap-2 border border-border bg-background px-3 text-sm select-none">
      {mode === 'record' ? (
        <span className="flex items-center gap-1.5 text-destructive">
          <span className="size-2 animate-pulse rounded-full bg-destructive" />
          REC
        </span>
      ) : (
        <span className="text-muted-foreground text-xs">Scroll the content…</span>
      )}

      <span className="min-w-14 flex-1 text-center font-mono text-xs tabular-nums text-muted-foreground">
        {status}
      </span>

      <button
        onClick={() => window.controlApi.action('done')}
        aria-label={mode === 'record' ? 'Stop and save' : 'Done, stitch frames'}
        className={cn(
          'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium outline-none',
          'bg-primary text-primary-foreground hover:bg-primary/90',
          'focus-visible:ring-[3px] focus-visible:ring-ring/50'
        )}
      >
        {mode === 'record' ? <Square className="size-3" /> : <Check className="size-3.5" />}
        {mode === 'record' ? 'Stop' : 'Done'}
      </button>

      <button
        onClick={() => window.controlApi.action('cancel')}
        aria-label="Cancel"
        className="flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

export default ControlBar
