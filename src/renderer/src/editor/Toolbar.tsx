import { cn } from '@renderer/lib/utils'
import { useEditorStore } from '@renderer/stores/editor'
import { TOOLS } from './tools'

function Toolbar(): React.JSX.Element {
  const tool = useEditorStore((s) => s.tool)
  const setTool = useEditorStore((s) => s.setTool)

  return (
    <nav
      aria-label="Annotation tools"
      className="flex w-12 flex-col items-center gap-1 border-r py-2"
    >
      {TOOLS.map(({ tool: t, icon: Icon, label, key }) => (
        <button
          key={t}
          onClick={() => setTool(t)}
          aria-label={`${label} (${key})`}
          aria-pressed={tool === t}
          title={`${label} — ${key}`}
          className={cn(
            'flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors',
            'outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
            tool === t &&
              'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
          )}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </nav>
  )
}

export default Toolbar
