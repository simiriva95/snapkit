import { cn } from '@renderer/lib/utils'

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  ariaLabel: string
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex rounded-md border p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded px-2.5 py-1 text-xs outline-none transition-colors',
            'focus-visible:ring-[3px] focus-visible:ring-ring/50',
            value === o.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
