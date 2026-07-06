import { useEffect, useState } from 'react'
import type { WindowSource } from '@shared/ipc'

/** Grid of capturable windows. Click captures, Esc cancels. */
function Picker(): React.JSX.Element {
  const [sources, setSources] = useState<WindowSource[]>([])

  useEffect(() => window.pickerApi.onInit((p) => setSources(p.sources)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.pickerApi.cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-10 shrink-0 items-center justify-between border-b px-4">
        <span className="text-xs font-medium text-muted-foreground">Pick a window to capture</span>
        <span className="text-xs text-muted-foreground/60">Esc to cancel</span>
      </header>

      <main className="grid flex-1 auto-rows-min grid-cols-3 gap-3 overflow-y-auto p-4">
        {sources.map((s) => (
          <button
            key={s.id}
            onClick={() => window.pickerApi.select(s.id)}
            title={s.name}
            className="group flex flex-col gap-1.5 rounded-lg border p-2 text-left outline-none transition-colors hover:border-primary hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <div className="flex h-24 items-center justify-center overflow-hidden rounded bg-muted/40">
              <img
                src={s.thumbnailDataUrl}
                alt=""
                draggable={false}
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <span className="truncate text-xs text-muted-foreground group-hover:text-foreground">
              {s.name}
            </span>
          </button>
        ))}
      </main>
    </div>
  )
}

export default Picker
