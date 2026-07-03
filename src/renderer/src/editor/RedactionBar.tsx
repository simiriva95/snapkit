import { Loader2, ShieldCheck, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useEditorStore } from '@renderer/stores/editor'

/** Floating status/confirm bar for the auto-redaction flow. */
function RedactionBar(): React.JSX.Element | null {
  const status = useEditorStore((s) => s.redactionStatus)
  const progress = useEditorStore((s) => s.redactionProgress)
  const error = useEditorStore((s) => s.redactionError)
  const proposals = useEditorStore((s) => s.proposals)
  const store = useEditorStore

  if (status === 'idle' && !error) return null

  const activeCount = proposals.filter((p) => p.active).length

  return (
    <div
      role="status"
      className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-popover px-4 py-2 text-sm text-popover-foreground shadow-lg"
    >
      {status === 'running' && (
        <>
          <Loader2 className="size-4 animate-spin" />
          Scanning locally for sensitive data… {Math.round(progress * 100)}%
        </>
      )}

      {status === 'review' && proposals.length > 0 && (
        <>
          <ShieldCheck className="size-4 text-destructive" />
          <span>
            <strong>{proposals.length}</strong> sensitive region
            {proposals.length === 1 ? '' : 's'} found — click a region to exclude it
          </span>
          <Button
            size="sm"
            disabled={activeCount === 0}
            onClick={() => store.getState().applyRedactions()}
          >
            Blur {activeCount}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => store.getState().clearRedaction()}>
            Cancel
          </Button>
        </>
      )}

      {status === 'review' && proposals.length === 0 && (
        <>
          <ShieldCheck className="size-4 text-green-500" />
          No sensitive data found
          <Button size="sm" variant="ghost" onClick={() => store.getState().clearRedaction()}>
            OK
          </Button>
        </>
      )}

      {error && (
        <>
          <X className="size-4 text-destructive" />
          {error}
          <Button size="sm" variant="ghost" onClick={() => store.getState().clearRedaction()}>
            Dismiss
          </Button>
        </>
      )}
    </div>
  )
}

export default RedactionBar
