/** Electron accelerator helpers: display formatting + keydown recording. */

export const IS_MAC = navigator.platform.startsWith('Mac')

/** Human display for an accelerator: mac symbols, Ctrl+ elsewhere. */
export function formatAccelerator(acc: string): string {
  const parts = acc.split('+')
  if (IS_MAC) {
    return parts
      .map((p) =>
        p === 'CommandOrControl' || p === 'Command'
          ? '⌘'
          : p === 'Shift'
            ? '⇧'
            : p === 'Alt'
              ? '⌥'
              : p === 'Control'
                ? '⌃'
                : p
      )
      .join('')
  }
  return parts.map((p) => (p === 'CommandOrControl' ? 'Ctrl' : p)).join('+')
}

/**
 * Build an accelerator from a keydown event, or null if the combo is
 * incomplete (modifier-only) or unusable (no modifier for a plain letter —
 * that would hijack normal typing globally).
 */
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  const key = e.key
  // Modifier-only presses are not a shortcut yet.
  if (['Meta', 'Control', 'Shift', 'Alt'].includes(key)) return null

  const mods: string[] = []
  if (e.metaKey || e.ctrlKey) mods.push('CommandOrControl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')

  let main: string
  if (/^[a-z]$/i.test(key)) main = key.toUpperCase()
  else if (/^[0-9]$/.test(key)) main = key
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) main = key
  else if (key === ' ') main = 'Space'
  else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
    main = key.replace('Arrow', '') // Up/Down/Left/Right
  } else return null

  // Global shortcuts need at least one real modifier (F-keys excepted).
  if (mods.length === 0 && !/^F\d/.test(main)) return null

  return [...mods, main].join('+')
}
