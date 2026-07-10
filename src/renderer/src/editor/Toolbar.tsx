import { Fragment } from 'react'
import { cn } from '@renderer/lib/utils'
import { useEditorStore } from '@renderer/stores/editor'
import { TOOLS } from './tools'

/** Visual grouping: pointer / drawing / privacy / clipboard actions. */
const GROUP_AFTER = new Set(['select', 'step', 'blur'])

function Toolbar(): React.JSX.Element {
  const tool = useEditorStore((s) => s.tool)
  const setTool = useEditorStore((s) => s.setTool)

  return (
    <nav
      aria-label="Annotation tools"
      className="flex w-12 flex-col items-center gap-1 border-r bg-card/50 py-2"
    >
      {TOOLS.map(({ tool: t, icon: Icon, label, key }) => (
        <Fragment key={t}>
          <button
            onClick={() => setTool(t)}
            aria-label={`${label} (${key})`}
            aria-pressed={tool === t}
            title={`${label} — ${key}`}
            className={cn(
              'relative flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors',
              'outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
              tool === t && 'bg-primary/15 text-primary hover:bg-primary/15 hover:text-primary'
            )}
          >
            <Icon className="size-4" strokeWidth={tool === t ? 2.25 : 2} />
          </button>
          {GROUP_AFTER.has(t) && <div className="my-0.5 h-px w-5 bg-border" aria-hidden />}
        </Fragment>
      ))}
    </nav>
  )
}

export default Toolbar
