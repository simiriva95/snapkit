import { useEffect, useState } from 'react'
import {
  AppWindow,
  Camera,
  Loader2,
  Minus,
  Monitor,
  MoveVertical,
  Settings,
  ShieldCheck,
  Video
} from 'lucide-react'
import type { LicenseStatus } from '@shared/license'
import { Button } from '@renderer/components/ui/button'
import { useCaptureStore } from '@renderer/stores/capture'
import { usePrefsStore } from '@renderer/stores/prefs'
import { dragRegion, noDrag } from '@renderer/lib/titlebar'
import { formatAccelerator } from '@renderer/lib/accelerator'
import { stitchFrames } from '@renderer/editor/stitch'
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
  const [license, setLicense] = useState<LicenseStatus | null>(null)
  const image = useCaptureStore((s) => s.image)
  const prefs = usePrefsStore((s) => s.prefs)
  const loadPrefs = usePrefsStore((s) => s.load)
  const savePrefs = usePrefsStore((s) => s.save)

  useEffect(() => {
    window.api.getVersion().then(setVersion).catch(console.error)
    window.api.getLicense().then(setLicense).catch(console.error)
    void loadPrefs()
  }, [loadPrefs, view])

  useEffect(
    () => window.api.onCapture((payload) => useCaptureStore.getState().setImage(payload)),
    []
  )

  // Scrolling capture: frames arrive from main, stitching happens here.
  const [stitching, setStitching] = useState(false)
  useEffect(
    () =>
      window.api.onScrollFrames((payload) => {
        setStitching(true)
        stitchFrames(payload.frames)
          .then(({ dataUrl, width, height }) => {
            const dipHeight = Math.round(height * (payload.dipWidth / width))
            useCaptureStore.getState().setImage({
              dataUrl,
              width: payload.dipWidth,
              height: dipHeight
            })
          })
          .catch((err) => console.error('[stitch]', err))
          .finally(() => setStitching(false))
      }),
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

      <main className="flex flex-1 flex-col justify-center gap-8 px-10">
        {/* Brand mark: the aperture glyph, drawn — not an icon-font blob. */}
        <div className="flex items-center gap-4">
          {/* Brand glyph: viewfinder crop marks + capture dot (same as app icon). */}
          <svg viewBox="0 0 40 40" className="size-11 shrink-0" aria-hidden>
            <g stroke="var(--primary)" strokeWidth="3.2" strokeLinecap="round" fill="none">
              <path d="M8 14v-2a4 4 0 0 1 4-4h2" />
              <path d="M26 8h2a4 4 0 0 1 4 4v2" />
              <path d="M32 26v2a4 4 0 0 1-4 4h-2" />
              <path d="M14 32h-2a4 4 0 0 1-4-4v-2" />
            </g>
            <circle cx="20" cy="20" r="3.6" fill="var(--primary)" />
          </svg>
          <div>
            <h1 className="text-[22px] leading-7 font-semibold tracking-tight">Snapkit</h1>
            <p className="text-sm text-muted-foreground">Capture. Redact. Ship — safely.</p>
          </div>
        </div>

        <div style={noDrag} className="flex flex-col gap-2">
          <button
            onClick={() => window.api.startCapture()}
            className="flex h-11 items-center justify-between rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span className="flex items-center gap-2.5">
              <Camera className="size-4" />
              Capture area
            </span>
            <kbd className="text-[11px] opacity-70">{shortcutLabel}</kbd>
          </button>

          <div className="grid grid-cols-2 gap-2">
            {(
              [
                {
                  icon: Monitor,
                  label: 'Full screen',
                  kbd: formatAccelerator(prefs?.fullscreenShortcut ?? 'CommandOrControl+Shift+1'),
                  mode: 'fullscreen' as const,
                  title: undefined
                },
                {
                  icon: AppWindow,
                  label: 'Window',
                  kbd: formatAccelerator(prefs?.windowShortcut ?? 'CommandOrControl+Shift+3'),
                  mode: 'window' as const,
                  title: undefined
                },
                {
                  icon: MoveVertical,
                  label: 'Scrolling',
                  kbd: formatAccelerator(prefs?.scrollingShortcut ?? 'CommandOrControl+Shift+6'),
                  mode: 'scrolling' as const,
                  title:
                    'Select an area, scroll the content, frames get stitched into one tall image'
                },
                {
                  icon: Video,
                  label: 'Record',
                  kbd: formatAccelerator(prefs?.recordShortcut ?? 'CommandOrControl+Shift+7'),
                  mode: 'record' as const,
                  title: 'Record an area of the screen (MP4 — presets in Preferences)'
                }
              ] as const
            ).map(({ icon: Icon, label, kbd, mode, title }) => (
              <button
                key={label}
                title={title}
                onClick={() => window.api.startCapture(mode)}
                className="flex h-10 items-center justify-between rounded-lg border bg-card px-3 text-[13px] text-foreground outline-none transition-colors hover:border-ring/40 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Icon className="size-3.5" />
                  <span className="text-foreground">{label}</span>
                </span>
                {kbd && <kbd className="text-[10px] text-muted-foreground/70">{kbd}</kbd>}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between border-t pt-4 text-xs text-muted-foreground/70">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-primary/80" />
            Never leaves this device
          </span>
          <span className="font-mono text-[10px] tabular-nums">
            {version && `v${version}`}
            {license?.kind === 'licensed' && '  ·  licensed'}
          </span>
        </div>
      </main>

      {stitching && (
        <div className="absolute inset-x-0 bottom-6 z-20 flex justify-center">
          <span className="flex items-center gap-2 rounded-md border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-lg">
            <Loader2 className="size-3.5 animate-spin" />
            Stitching frames…
          </span>
        </div>
      )}

      {prefs && !prefs.onboardingDone && (
        <Onboarding onDone={() => void savePrefs({ onboardingDone: true })} />
      )}
    </div>
  )
}

export default App
