import { useEffect, useRef, useState, type RefObject } from 'react'
import { FRAME_SEC } from '@shared/videoPlan'
import { cn } from '@renderer/lib/utils'
import { buildFilmstrip } from './filmstrip'
import { fmtTime } from './format'
import { useVideoStore } from './store'

const THUMBS = 20

export function Timeline({
  videoRef
}: {
  videoRef: RefObject<HTMLVideoElement | null>
}): React.JSX.Element | null {
  const { file, meta, edits, playhead, patchEdits } = useVideoStore()
  const [thumbs, setThumbs] = useState<string[]>([])
  const [thumbsFor, setThumbsFor] = useState<typeof file>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef<'in' | 'out' | null>(null)

  // Reset thumbs synchronously during render when the file identity changes
  // (React's "adjusting state when a prop changes" pattern), so the effect
  // below only ever appends — it never calls setState directly in its body.
  if (file !== thumbsFor) {
    setThumbsFor(file)
    setThumbs([])
  }

  // Filmstrip: rebuilt when the file changes; aborted if it changes again mid-way.
  useEffect(() => {
    if (!file || !meta) return
    const ac = new AbortController()
    void buildFilmstrip(file.url, meta.durationSec, THUMBS, 160, ac.signal).then((t) => {
      if (!ac.signal.aborted) setThumbs(t)
    })
    return () => ac.abort()
  }, [file, meta])

  // Keyboard: I/O set in/out at the playhead, [ ] nudge the nearer handle, Space toggles play.
  useEffect(() => {
    if (!meta || !edits) return
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      const v = videoRef.current
      const t = v?.currentTime ?? useVideoStore.getState().playhead
      if (e.key === 'i' || e.key === 'I') patchEdits({ inSec: t })
      else if (e.key === 'o' || e.key === 'O') patchEdits({ outSec: t })
      else if (e.key === '[' || e.key === ']') {
        const delta = e.key === '[' ? -FRAME_SEC : FRAME_SEC
        const nearerIsIn = Math.abs(t - edits.inSec) <= Math.abs(t - edits.outSec)
        patchEdits(nearerIsIn ? { inSec: edits.inSec + delta } : { outSec: edits.outSec + delta })
      } else if (e.key === ' ' && v) {
        e.preventDefault()
        if (v.paused) void v.play()
        else v.pause()
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [meta, edits, patchEdits, videoRef])

  if (!file || !meta || !edits) return null
  const dur = meta.durationSec
  const pct = (sec: number): number => (dur > 0 ? (sec / dur) * 100 : 0)

  const secAt = (clientX: number): number => {
    const el = trackRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    return Math.min(dur, Math.max(0, ((clientX - r.left) / r.width) * dur))
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (!dragging.current) return
    const t = secAt(e.clientX)
    patchEdits(dragging.current === 'in' ? { inSec: t } : { outSec: t })
    if (videoRef.current) videoRef.current.currentTime = t
  }
  const startDrag =
    (which: 'in' | 'out') =>
    (e: React.PointerEvent): void => {
      dragging.current = which
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }
  const endDrag = (): void => {
    dragging.current = null
  }
  const seek = (e: React.MouseEvent): void => {
    if (dragging.current || !videoRef.current) return
    videoRef.current.currentTime = secAt(e.clientX)
  }

  return (
    <div className="shrink-0 select-none">
      <div
        ref={trackRef}
        className="relative h-16 overflow-hidden rounded-md border bg-muted"
        onClick={seek}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="flex h-full">
          {thumbs.length === 0
            ? Array.from({ length: THUMBS }, (_, i) => (
                <div
                  key={i}
                  className="h-full flex-1 animate-pulse border-r border-background/40"
                />
              ))
            : thumbs.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt=""
                  draggable={false}
                  className="h-full flex-1 object-cover"
                />
              ))}
        </div>
        {/* dimmed outside the range */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-background/70"
          style={{ width: `${pct(edits.inSec)}%` }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 bg-background/70"
          style={{ width: `${100 - pct(edits.outSec)}%` }}
        />
        {/* playhead */}
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-foreground"
          style={{ left: `${pct(playhead)}%` }}
        />
        {/* handles */}
        {(['in', 'out'] as const).map((which) => (
          <div
            key={which}
            role="slider"
            aria-label={which === 'in' ? 'Trim start' : 'Trim end'}
            aria-valuenow={which === 'in' ? edits.inSec : edits.outSec}
            aria-valuemin={0}
            aria-valuemax={dur}
            tabIndex={0}
            onPointerDown={startDrag(which)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
              e.preventDefault()
              const step = (e.key === 'ArrowLeft' ? -1 : 1) * FRAME_SEC * (e.shiftKey ? 10 : 1)
              patchEdits(
                which === 'in' ? { inSec: edits.inSec + step } : { outSec: edits.outSec + step }
              )
            }}
            className={cn(
              'absolute inset-y-0 w-2.5 cursor-ew-resize rounded-sm bg-primary',
              which === 'in' ? '-translate-x-full' : ''
            )}
            style={{ left: `${pct(which === 'in' ? edits.inSec : edits.outSec)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>I {fmtTime(edits.inSec)}</span>
        <span>{fmtTime(playhead)}</span>
        <span>O {fmtTime(edits.outSec)}</span>
      </div>
    </div>
  )
}
