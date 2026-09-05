import { Button } from '@renderer/components/ui/button'
import { Segmented } from '@renderer/components/ui/segmented'
import { Toggle } from '@renderer/components/ui/toggle'
import {
  canCopy,
  estimateBytes,
  isTrimmed,
  type ExportEdits,
  type ExportHeight,
  type GifFps,
  type VideoMeta
} from '@shared/videoPlan'
import { fmtBytes, fmtTime } from './format'
import { useVideoStore } from './store'

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

/** The options themselves need meta; the footer around them does not. */
function Options({ meta, edits }: { meta: VideoMeta; edits: ExportEdits }): React.JSX.Element {
  const patchEdits = useVideoStore((s) => s.patchEdits)
  const gif = edits.container === 'gif'
  const copyOk = canCopy(edits, meta)
  const heights = ([1080, 720, 480] as const).filter((h) => h < meta.height)
  const modeValue =
    edits.mode.kind === 'copy' ? 'copy' : edits.mode.kind === 'size' ? 'size' : edits.mode.quality

  return (
    <>
      <Row label="Format">
        <Segmented
          ariaLabel="Format"
          value={edits.container}
          options={[
            { value: 'mp4', label: 'MP4' },
            { value: 'webm', label: 'WebM' },
            { value: 'gif', label: 'GIF' }
          ]}
          onChange={(container) => patchEdits({ container })}
        />
      </Row>
      {!gif && (
        <Row label="Resolution">
          <Segmented<ExportHeight>
            ariaLabel="Resolution"
            value={edits.height}
            options={[
              { value: 'native', label: 'Native' },
              ...heights.map((h) => ({ value: h, label: `${h}p` }))
            ]}
            onChange={(height) => patchEdits({ height })}
          />
        </Row>
      )}
      {!gif && (
        <Row label="Compression">
          <Segmented
            ariaLabel="Compression"
            value={modeValue}
            options={[
              ...(copyOk ? [{ value: 'copy', label: 'Original' }] : []),
              { value: 'high', label: 'High' },
              { value: 'medium', label: 'Med' },
              { value: 'low', label: 'Low' },
              { value: 'size', label: 'Size' }
            ]}
            onChange={(v) =>
              patchEdits({
                mode:
                  v === 'copy'
                    ? { kind: 'copy' }
                    : v === 'size'
                      ? { kind: 'size', targetMB: 10 }
                      : { kind: 'quality', quality: v as 'high' | 'medium' | 'low' }
              })
            }
          />
        </Row>
      )}
      {!gif && edits.mode.kind === 'size' && (
        <Row label="Target size">
          <input
            type="number"
            min={1}
            step={1}
            value={edits.mode.targetMB}
            onChange={(e) =>
              patchEdits({
                mode: { kind: 'size', targetMB: Math.max(1, Number(e.target.value) || 1) }
              })
            }
            className="h-8 w-20 rounded-md border bg-background px-2 text-right text-xs"
            aria-label="Target size in megabytes"
          />
          <span className="text-xs text-muted-foreground">MB</span>
        </Row>
      )}
      {!gif && (
        <Row label="Mute audio">
          <Toggle
            ariaLabel="Mute audio"
            checked={edits.mute}
            onChange={(mute) => patchEdits({ mute })}
          />
        </Row>
      )}
      {gif && (
        <Row label="GIF frame rate">
          <Segmented<GifFps>
            ariaLabel="GIF frame rate"
            value={edits.gifFps}
            options={[
              { value: 10, label: '10' },
              { value: 15, label: '15' },
              { value: 20, label: '20' }
            ]}
            onChange={(gifFps) => patchEdits({ gifFps })}
          />
        </Row>
      )}
      {gif && (
        <Row label="GIF max width">
          <Segmented
            ariaLabel="GIF max width"
            value={edits.gifMaxWidth}
            options={[
              { value: 480, label: '480' },
              { value: 640, label: '640' },
              { value: 960, label: '960' }
            ]}
            onChange={(gifMaxWidth) => patchEdits({ gifMaxWidth })}
          />
        </Row>
      )}
      <div>
        <Row label="Range">
          <span className="font-mono text-xs">
            {fmtTime(edits.inSec)} → {fmtTime(edits.outSec)}
          </span>
        </Row>
        {edits.mode.kind === 'copy' && isTrimmed(edits, meta) && (
          <p className="pb-2.5 text-[11px] leading-snug text-muted-foreground">
            Original keeps the source keyframes: the start may land a few seconds earlier. Pick
            High/Med/Low for a frame-exact cut.
          </p>
        )}
      </div>
      <Row label="Estimated size">
        <span className="font-mono text-xs">≈ {fmtBytes(estimateBytes(edits, meta))}</span>
      </Row>
    </>
  )
}

export function ExportPanel(): React.JSX.Element {
  const { file, meta, edits, exporting, result, sourceError, runExport, cancelExport } =
    useVideoStore()
  if (!file)
    return <aside className="w-72 border-l p-4 text-xs text-muted-foreground">Loading…</aside>
  const canExport = file.ffmpegAvailable && !sourceError && !exporting && !!meta && !!edits

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l">
      <div className="flex-1 overflow-y-auto divide-y px-4">
        {meta && edits ? (
          <Options meta={meta} edits={edits} />
        ) : (
          <p className="py-4 text-xs text-muted-foreground">
            {sourceError ? 'No options available.' : 'Reading the video…'}
          </p>
        )}
      </div>

      <div className="space-y-2 border-t p-4">
        {exporting ? (
          <>
            <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${Math.round(exporting.progress * 100)}%` }}
              />
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={cancelExport}>
              Cancel
            </Button>
          </>
        ) : (
          <Button className="w-full" disabled={!canExport} onClick={() => void runExport()}>
            Export…
          </Button>
        )}
        {!file.ffmpegAvailable && (
          <p className="text-xs text-destructive">
            ffmpeg is missing — reinstall Snapkit to export.
          </p>
        )}
        {sourceError && <p className="text-xs text-destructive">{sourceError}</p>}
        {result && !result.ok && (
          <p className="break-words text-xs text-destructive">{result.error}</p>
        )}
        {result?.ok && (
          <p className="truncate text-xs text-muted-foreground" title={result.output}>
            Saved: {result.output}
          </p>
        )}
      </div>
    </aside>
  )
}
