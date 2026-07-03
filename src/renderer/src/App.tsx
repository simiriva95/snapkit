import { useEffect, useState } from 'react'
import { Camera, Minus, Settings, ShieldCheck } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useCaptureStore } from '@renderer/stores/capture'
import { usePrefsStore } from '@renderer/stores/prefs'
import { dragRegion, noDrag } from '@renderer/lib/titlebar'
import { formatAccelerator } from '@renderer/lib/accelerator'
import Editor from './Editor'
import PrefsPanel from './PrefsPanel'

function Onboarding({ onDone }: { onDone: () => void }): React.JSX.Element {
  const prefs = usePrefsStore((s) => s.prefs)
  const shortcuts = [
    {
      keys: formatAccelerator(prefs?.captureShortcut ?? 'CommandOrControl+Shift+2'),
      what: 'Capture an area'
    },
    { keys: formatAccelerator('CommandOrControl+Z'), what: 'Undo in the editor' },
    { keys: formatAccelerator('CommandOrControl+C'), what: 'Copy the result' }
  ]
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div
        role="dialog"
        aria-label="Welcome"
        className="w-80 rounded-xl border bg-card p-6 shadow-xl"
      >
        <h2 className="text-lg font-semibold">Welcome to Snapkit</h2>
        <p className="mt-1 text-sm text-muted-foreground">Three shortcuts and you're set:</p>
        <ul className="mt-4 space-y-3">
          {shortcuts.map((s) => (
            <li key={s.what} className="flex items-center justify-between text-sm">
              {s.what}
              <kbd className="rounded-md border bg-muted px-2 py-1 font-mono text-xs">{s.keys}</kbd>
            </li>
          ))}
        </ul>
        <Button className="mt-6 w-full" onClick={onDone} autoFocus>
          Got it
        </Button>
      </div>
    </div>
  )
}

function App(): React.JSX.Element {
  const [version, setVersion] = useState('')
  const [view, setView] = useState<'home' | 'prefs'>('home')
  const image = useCaptureStore((s) => s.image)
  const prefs = usePrefsStore((s) => s.prefs)
  const loadPrefs = usePrefsStore((s) => s.load)
  const savePrefs = usePrefsStore((s) => s.save)

  useEffect(() => {
    window.api.getVersion().then(setVersion).catch(console.error)
    void loadPrefs()
  }, [loadPrefs])

  useEffect(
    () => window.api.onCapture((payload) => useCaptureStore.getState().setImage(payload)),
    []
  )

  // Theme: dark by default, honoring prefers-color-scheme in 'system' mode.
  const theme = prefs?.theme ?? 'dark'
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    if (theme === 'system') {
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
    return undefined
  }, [theme])

  if (image) return <Editor />
  if (view === 'prefs') return <PrefsPanel onBack={() => setView('home')} />

  const shortcutLabel = formatAccelerator(prefs?.captureShortcut ?? 'CommandOrControl+Shift+2')

  return (
    <div className="relative flex h-full flex-col">
      <header
        style={dragRegion}
        className="flex h-11 shrink-0 items-center justify-between px-3 pl-20"
      >
        <span className="text-xs font-medium text-muted-foreground">Snapkit</span>
        <div style={noDrag} className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Preferences"
            onClick={() => setView('prefs')}
          >
            <Settings className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Hide window"
            onClick={() => window.api.hideWindow()}
          >
            <Minus className="size-4" />
          </Button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-8 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Camera className="size-8" />
        </div>

        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Snapkit</h1>
          <p className="text-sm text-muted-foreground">Capture. Redact. Ship — safely.</p>
        </div>

        <div className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          Your screenshots never leave this device
        </div>

        <Button style={noDrag} onClick={() => window.api.startCapture()}>
          <Camera />
          Capture area
          <kbd className="rounded bg-primary-foreground/15 px-1.5 py-0.5 text-[11px] font-normal">
            {shortcutLabel}
          </kbd>
        </Button>

        {version && (
          <span className="text-xs text-muted-foreground/60">v{version} · Milestone 5</span>
        )}
      </main>

      {prefs && !prefs.onboardingDone && (
        <Onboarding onDone={() => void savePrefs({ onboardingDone: true })} />
      )}
    </div>
  )
}

export default App
