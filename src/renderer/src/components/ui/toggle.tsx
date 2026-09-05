import { cn } from '@renderer/lib/utils'

export function Toggle({
  checked,
  onChange,
  ariaLabel
}: {
  checked: boolean
  onChange: (v: boolean) => void
  ariaLabel: string
}): React.JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={cn(
        'h-6 w-10 rounded-full p-0.5 outline-none transition-colors',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
        checked ? 'bg-primary' : 'bg-input'
      )}
    >
      <span
        className={cn(
          'block size-5 rounded-full bg-background shadow transition-transform',
          checked && 'translate-x-4'
        )}
      />
    </button>
  )
}
