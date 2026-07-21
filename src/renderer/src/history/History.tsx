import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pin, Search, X } from 'lucide-react'
import type { HistoryEntry } from '@shared/ipc'

const COLS = 3

/** Compact relative age: "now", "5m", "3h", "2d". */
function ago(ts: number): string {
  const s = (Date.now() - ts) / 1000
  if (s < 60) return 'now'
  const m = s / 60
  if (m < 60) return `${Math.floor(m)}m`
  const h = m / 60
  if (h < 24) return `${Math.floor(h)}h`
  return `${Math.floor(h / 24)}d`
}

/** Win+V-style panel: search, arrow-key nav, pin, delete. */
function History(): React.JSX.Element {
  const [items, setItems] = useState<HistoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => {
    void window.historyApi.list().then(setItems)
  }, [])

  useEffect(() => {
    refresh()
    return window.historyApi.onChanged(refresh)
  }, [refresh])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    // Text entries match their content; images match their OCR'd text.
    return items.filter((it) =>
      (it.type === 'text' ? it.text : it.ocrText)?.toLowerCase().includes(q)
    )
  }, [items, query])

  // Clamp during render — the list shrinks as you search or delete.
  const active = shown.length ? Math.min(sel, shown.length - 1) : 0

  const copy = (id: string): void => window.historyApi.copy(id)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (query) setQuery('')
        else window.historyApi.cancel()
        return
      }
      if (e.key === 'Enter') {
        const it = shown[active]
        if (it) copy(it.id)
        return
      }
      const move = (d: number): void => {
        e.preventDefault()
        setSel((s) => Math.max(0, Math.min(shown.length - 1, s + d)))
      }
      if (e.key === 'ArrowRight') move(1)
      else if (e.key === 'ArrowLeft') move(-1)
      else if (e.key === 'ArrowDown') move(COLS)
      else if (e.key === 'ArrowUp') move(-COLS)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shown, active, query])

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <Search className="size-4 shrink-0 text-muted-foreground/60" />
        <input
          ref={searchRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clipboard…"
          aria-label="Search clipboard history"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
        />
        {items.length > 0 && (
          <button
            onClick={() => window.historyApi.clear()}
            className="shrink-0 text-xs text-muted-foreground/70 outline-none hover:text-foreground"
          >
            Clear
          </button>
        )}
      </header>

      {shown.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-muted-foreground/60">
          {query ? 'No matches.' : 'Nothing copied yet — copy some text or take a snapshot.'}
        </div>
      ) : (
        <main className="grid flex-1 auto-rows-min grid-cols-3 gap-3 overflow-y-auto p-4">
          {shown.map((it, i) => (
            <div
              key={it.id}
              onClick={() => copy(it.id)}
              onMouseEnter={() => setSel(i)}
              title={it.type === 'text' ? it.text : 'Image'}
              className={`group relative flex h-24 cursor-pointer flex-col overflow-hidden rounded-lg border p-2 text-left outline-none transition-colors hover:bg-accent ${
                i === active ? 'border-primary ring-[3px] ring-ring/50' : 'hover:border-primary'
              }`}
            >
              {it.type === 'image' ? (
                <div className="flex h-full items-center justify-center overflow-hidden rounded bg-muted/40">
                  <img
                    src={it.thumbDataUrl}
                    alt=""
                    draggable={false}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              ) : (
                <span className="line-clamp-4 whitespace-pre-wrap break-words text-xs text-muted-foreground group-hover:text-foreground">
                  {it.text}
                </span>
              )}

              {/* actions — visible on hover or when pinned */}
              <div
                className={`absolute right-1 top-1 flex gap-0.5 ${
                  it.pinned ? '' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    window.historyApi.pin(it.id)
                  }}
                  aria-label={it.pinned ? 'Unpin' : 'Pin'}
                  className={`rounded p-1 backdrop-blur-sm transition-colors hover:bg-background ${
                    it.pinned ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  <Pin className={`size-3.5 ${it.pinned ? 'fill-current' : ''}`} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    window.historyApi.remove(it.id)
                  }}
                  aria-label="Delete"
                  className="rounded p-1 text-muted-foreground backdrop-blur-sm transition-colors hover:bg-background hover:text-destructive"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              <span className="absolute bottom-1 right-1.5 text-[10px] tabular-nums text-muted-foreground/50">
                {ago(it.ts)}
              </span>
            </div>
          ))}
        </main>
      )}
    </div>
  )
}

export default History
