import { useEffect, useRef } from 'react'
import { FolderOpen } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { dragRegion, noDrag } from '@renderer/lib/titlebar'
import { ExportPanel } from './ExportPanel'
import { Player } from './Player'
import { Timeline } from './Timeline'
import { fmtBytes, fmtTime } from './format'
import { useVideoStore } from './store'

export function VideoEditor(): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { file, meta, openSeq, setFile } = useVideoStore()

  useEffect(() => window.videoApi.onOpen(setFile), [setFile])
  useEffect(() => {
    const off = window.videoApi.onProgress((progress) =>
      useVideoStore.setState((s) => (s.exporting ? { exporting: { progress } } : {}))
    )
    return off
  }, [])

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) window.videoApi.openDropped(f)
  }

  return (
    <div
      className="flex h-screen flex-col bg-background text-foreground"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <header
        style={dragRegion}
        className="flex h-11 shrink-0 items-center gap-3 border-b px-3 pl-20"
      >
        <span className="truncate text-xs font-medium text-muted-foreground">
          {file?.name ?? 'Snapkit Video'}
        </span>
        <div className="ml-auto" style={noDrag}>
          <Button variant="ghost" size="sm" onClick={() => void window.videoApi.pickFile()}>
            <FolderOpen /> Open…
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {file ? (
              // Keyed on the open counter: re-opening the same file remounts the
              // element, so loadedmetadata fires again and meta is rebuilt.
              <Player key={openSeq} ref={videoRef} src={file.url} />
            ) : (
              <p className="text-sm text-muted-foreground">Drop a video here or use Open…</p>
            )}
          </div>
          {file && <Timeline videoRef={videoRef} />}
          {file && meta && (
            <p className="font-mono text-[11px] text-muted-foreground">
              {meta.width}×{meta.height} · {fmtTime(meta.durationSec)} · {fmtBytes(meta.sizeBytes)}
            </p>
          )}
        </main>
        <ExportPanel />
      </div>
    </div>
  )
}
