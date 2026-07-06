import { useEffect, useState } from 'react'
import { ArrowLeft, Folder, KeyRound, Keyboard } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { usePrefsStore } from '@renderer/stores/prefs'
import { acceleratorFromEvent, formatAccelerator } from '@renderer/lib/accelerator'
import { cn } from '@renderer/lib/utils'
import { dragRegion, noDrag } from '@renderer/lib/titlebar'
import type { Prefs } from '@shared/prefs'
import type { LicenseStatus } from '@shared/license'

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

function Segmented<T extends string>({
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
          key={o.value}
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

function ShortcutRecorder({
  label,
  value,
  onRecord
}: {
  label: string
  value: string
  onRecord: (accelerator: string) => void
}): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  return (
    <button
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={(e) => {
        if (!recording) return
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Escape') {
          setRecording(false)
          return
        }
        const acc = acceleratorFromEvent(e.nativeEvent)
        if (acc) {
          setRecording(false)
          onRecord(acc)
        }
      }}
      aria-label={`${label} — click, then press the new combination`}
      className={cn(
        'flex min-w-28 items-center justify-center gap-2 rounded-md border px-3 py-1.5 font-mono text-sm outline-none',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
        recording && 'border-primary text-muted-foreground'
      )}
    >
      <Keyboard className="size-3.5" />
      {recording ? 'Press keys…' : formatAccelerator(value)}
    </button>
  )
}

function LicenseRow(): React.JSX.Element {
  const [status, setStatus] = useState<LicenseStatus | null>(null)
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.getLicense().then(setStatus).catch(console.error)
  }, [])

  const activate = (): void => {
    setError(null)
    void window.api.activateLicense(key).then((res) => {
      setStatus(res.status)
      if (!res.ok) setError(res.error ?? 'Activation failed')
      else setKey('')
    })
  }

  if (status?.kind === 'licensed') {
    return (
      <Row label="License">
        <span className="flex items-center gap-1.5 text-xs text-green-500">
          <KeyRound className="size-3.5" />
          Licensed · {status.key.slice(0, 24)}…
        </span>
      </Row>
    )
  }

  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm">
          License
          {status?.kind === 'trial' && (
            <span className="ml-2 text-xs text-amber-500">trial — {status.daysLeft}d left</span>
          )}
          {status?.kind === 'expired' && (
            <span className="ml-2 text-xs text-destructive">trial expired</span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && activate()}
            placeholder="SNAPK1.…"
            aria-label="License key"
            className="w-56 rounded-md border bg-transparent px-2 py-1.5 font-mono text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <Button size="sm" variant="outline" disabled={key.trim() === ''} onClick={activate}>
            Activate
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function PrefsPanel({ onBack }: { onBack: () => void }): React.JSX.Element {
  const prefs = usePrefsStore((s) => s.prefs)
  const save = usePrefsStore((s) => s.save)
  const [error, setError] = useState<string | null>(null)

  if (!prefs) return <></>

  const patch = (p: Partial<Prefs>): void => {
    setError(null)
    void save(p).then((err) => setError(err))
  }

  return (
    <div className="flex h-full flex-col">
      <header
        style={dragRegion}
        className="flex h-11 shrink-0 items-center gap-2 border-b px-3 pl-20"
      >
        <Button
          style={noDrag}
          variant="ghost"
          size="icon"
          aria-label="Back"
          onClick={onBack}
          autoFocus
        >
          <ArrowLeft className="size-4" />
        </Button>
        <span className="text-xs font-medium text-muted-foreground">Preferences</span>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-md divide-y">
          <Row label="Capture area">
            <ShortcutRecorder
              label="Area capture shortcut"
              value={prefs.captureShortcut}
              onRecord={(acc) => patch({ captureShortcut: acc })}
            />
          </Row>

          <Row label="Capture full screen">
            <ShortcutRecorder
              label="Full-screen capture shortcut"
              value={prefs.fullscreenShortcut}
              onRecord={(acc) => patch({ fullscreenShortcut: acc })}
            />
          </Row>

          <Row label="Capture window">
            <ShortcutRecorder
              label="Window capture shortcut"
              value={prefs.windowShortcut}
              onRecord={(acc) => patch({ windowShortcut: acc })}
            />
          </Row>

          <Row label="Theme">
            <Segmented
              ariaLabel="Theme"
              value={prefs.theme}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
                { value: 'system', label: 'System' }
              ]}
              onChange={(theme) => patch({ theme })}
            />
          </Row>

          <Row label="Export format">
            <Segmented
              ariaLabel="Export format"
              value={prefs.exportFormat}
              options={[
                { value: 'png', label: 'PNG' },
                { value: 'jpg', label: 'JPG' }
              ]}
              onChange={(exportFormat) => patch({ exportFormat })}
            />
          </Row>

          <Row label="Export folder">
            <span
              className="max-w-44 truncate text-xs text-muted-foreground"
              title={prefs.exportDir ?? 'Desktop'}
            >
              {prefs.exportDir ?? 'Desktop'}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void window.api.pickExportDir().then((dir) => dir && patch({ exportDir: dir }))
              }
            >
              <Folder />
              Choose…
            </Button>
          </Row>

          <LicenseRow />

          <Row label="Auto-redact after capture">
            <button
              role="switch"
              aria-checked={prefs.autoRedactOnCapture}
              aria-label="Auto-redact after capture"
              onClick={() => patch({ autoRedactOnCapture: !prefs.autoRedactOnCapture })}
              className={cn(
                'h-6 w-10 rounded-full p-0.5 outline-none transition-colors',
                'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                prefs.autoRedactOnCapture ? 'bg-primary' : 'bg-input'
              )}
            >
              <span
                className={cn(
                  'block size-5 rounded-full bg-background shadow transition-transform',
                  prefs.autoRedactOnCapture && 'translate-x-4'
                )}
              />
            </button>
          </Row>
        </div>

        {error && (
          <p role="alert" className="mx-auto mt-4 max-w-md text-sm text-destructive">
            {error}
          </p>
        )}

        <p className="mx-auto mt-6 max-w-md text-xs text-muted-foreground">
          Everything runs locally — your screenshots never leave this device.
        </p>
      </main>
    </div>
  )
}

export default PrefsPanel
