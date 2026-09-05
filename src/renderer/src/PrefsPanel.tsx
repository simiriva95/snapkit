import { useEffect, useState } from 'react'
import { ArrowLeft, Folder, KeyRound, Keyboard } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Segmented } from '@renderer/components/ui/segmented'
import { Toggle } from '@renderer/components/ui/toggle'
import { usePrefsStore } from '@renderer/stores/prefs'
import { acceleratorFromEvent, formatAccelerator } from '@renderer/lib/accelerator'
import { cn } from '@renderer/lib/utils'
import { dragRegion, noDrag } from '@renderer/lib/titlebar'
import { STYLED_TEMPLATES } from '@renderer/editor/exporter'
import { BUNDLED_OCR_LANGUAGES, type Prefs } from '@shared/prefs'
import type { LicenseStatus } from '@shared/license'

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
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
          <span className="ml-2 text-xs text-muted-foreground">optional</span>
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

          <Row label="Scrolling capture">
            <ShortcutRecorder
              label="Scrolling capture shortcut"
              value={prefs.scrollingShortcut}
              onRecord={(acc) => patch({ scrollingShortcut: acc })}
            />
          </Row>

          <Row label="Record area">
            <ShortcutRecorder
              label="Area recording shortcut"
              value={prefs.recordShortcut}
              onRecord={(acc) => patch({ recordShortcut: acc })}
            />
          </Row>

          <Row label="Record screen">
            <ShortcutRecorder
              label="Screen recording shortcut"
              value={prefs.recordScreenShortcut}
              onRecord={(acc) => patch({ recordScreenShortcut: acc })}
            />
          </Row>

          <Row label="Record window">
            <ShortcutRecorder
              label="Window recording shortcut"
              value={prefs.recordWindowShortcut}
              onRecord={(acc) => patch({ recordWindowShortcut: acc })}
            />
          </Row>

          <Row label="Clipboard history">
            <ShortcutRecorder
              label="Clipboard history shortcut"
              value={prefs.historyShortcut}
              onRecord={(acc) => patch({ historyShortcut: acc })}
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

          <Row label="Recording format">
            <Segmented
              ariaLabel="Recording format"
              value={prefs.recordFormat}
              options={[
                { value: 'mp4', label: 'MP4' },
                { value: 'webm', label: 'WebM' }
              ]}
              onChange={(recordFormat) => patch({ recordFormat })}
            />
          </Row>

          <Row label="Recording resolution">
            <Segmented
              ariaLabel="Recording resolution"
              value={prefs.recordResolution}
              options={[
                { value: 'native', label: 'Native' },
                { value: 1440, label: '1440p' },
                { value: 1080, label: '1080p' },
                { value: 720, label: '720p' }
              ]}
              onChange={(recordResolution) => patch({ recordResolution })}
            />
          </Row>

          <Row label="Recording frame rate">
            <Segmented
              ariaLabel="Recording frame rate"
              value={prefs.recordFps}
              options={[
                { value: 30, label: '30 fps' },
                { value: 60, label: '60 fps' }
              ]}
              onChange={(recordFps) => patch({ recordFps })}
            />
          </Row>

          <Row label="Record system audio">
            <Toggle
              ariaLabel="Record system audio"
              checked={prefs.recordSystemAudio}
              onChange={(recordSystemAudio) => patch({ recordSystemAudio })}
            />
          </Row>

          <Row label="Record microphone">
            <Toggle
              ariaLabel="Record microphone"
              checked={prefs.recordMic}
              onChange={(recordMic) => patch({ recordMic })}
            />
          </Row>

          <Row label="Styled copy backdrop">
            <Segmented
              ariaLabel="Styled copy backdrop"
              value={prefs.styledTemplate as never}
              options={STYLED_TEMPLATES.map((t) => ({ value: t.id as never, label: t.label }))}
              onChange={(styledTemplate) => patch({ styledTemplate })}
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

          <div className="py-3">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm">OCR languages</span>
              <div
                className="flex flex-wrap justify-end gap-1.5"
                role="group"
                aria-label="OCR languages"
              >
                {BUNDLED_OCR_LANGUAGES.map((lang) => {
                  const active = prefs.ocrLanguages.includes(lang.code)
                  return (
                    <button
                      key={lang.code}
                      role="checkbox"
                      aria-checked={active}
                      aria-label={lang.label}
                      onClick={() => {
                        const next = active
                          ? prefs.ocrLanguages.filter((c) => c !== lang.code)
                          : [...prefs.ocrLanguages, lang.code]
                        if (next.length > 0) patch({ ocrLanguages: next })
                      }}
                      className={cn(
                        'rounded-md border px-2 py-1 text-xs outline-none transition-colors',
                        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {lang.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <Row label="Start at system start">
            <Toggle
              ariaLabel="Start at system start"
              checked={prefs.launchAtLogin}
              onChange={(v) => patch({ launchAtLogin: v })}
            />
          </Row>

          <Row label="Auto-redact after capture">
            <Toggle
              ariaLabel="Auto-redact after capture"
              checked={prefs.autoRedactOnCapture}
              onChange={(v) => patch({ autoRedactOnCapture: v })}
            />
          </Row>

          <Row label="Auto-copy capture to clipboard">
            <Toggle
              ariaLabel="Auto-copy capture to clipboard"
              checked={prefs.autoCopyOnCapture}
              onChange={(v) => patch({ autoCopyOnCapture: v })}
            />
          </Row>

          <Row label="Track clipboard history">
            <Toggle
              ariaLabel="Track clipboard history"
              checked={prefs.clipboardHistory}
              onChange={(v) => patch({ clipboardHistory: v })}
            />
          </Row>

          <Row label="Auto-paste picked item">
            <Toggle
              ariaLabel="Auto-paste picked item"
              checked={prefs.autoPaste}
              onChange={(v) => patch({ autoPaste: v })}
            />
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
