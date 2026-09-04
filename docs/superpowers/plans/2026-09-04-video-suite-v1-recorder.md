# Video Suite V1 — Recorder pro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the area-only WebM/GIF recorder into a proper screen recorder: area / full screen / window sources, MP4 (H.264+AAC) output, resolution and frame-rate presets, microphone and system audio.

**Architecture:** Capture stays on Chromium (`getDisplayMedia` routed by main's `setDisplayMediaRequestHandler`, encoded by `MediaRecorder`). Main decides *what* to record (`RecordTarget` → `RecordJob`), the hidden recorder renderer decides *how* (constraints, canvas crop for area, audio merge, mime/bitrate). All sizing/bitrate/mime decisions are pure functions in `src/shared/recordPlan.ts` with golden tests. Saving is unchanged (save dialog) until V3's editor replaces it.

**Tech Stack:** Electron 43 (Chromium MediaRecorder mp4, loopback audio on macOS+Windows per V0 spike), electron-vite 5, React 19 + Tailwind v4 prefs UI, zustand, vitest 4. No new dependencies; `gifenc` removed.

Spec: `docs/superpowers/specs/2026-09-03-video-suite-design.md` §3 V1 + the V0 **Outcome** paragraph (system audio must be requested raw/stereo; real output size comes from the preset, not `track.getSettings()`).

Branch: create `claude/snapkit-video-suite-v1` from the V0 branch head (`claude/snapkit-video-suite-9da6d2`, PR #10). Stacked; rebase onto `main` once #10 merges.

## Global Constraints

- No new npm dependencies. Remove `gifenc` (`package.json`, lockfile, `src/renderer/src/recorder/gifenc.d.ts`).
- Prefs (exact names/defaults): `recordFormat: 'mp4' | 'webm'` default `'mp4'` (stored `'gif'` migrates to `'mp4'`); `recordResolution: 'native' | 1440 | 1080 | 720` default `'native'`; `recordFps: 30 | 60` default `30`; `recordMic: boolean` default `false`; `recordSystemAudio: boolean` default `true`; `recordScreenShortcut` default `'CommandOrControl+Shift+9'`; `recordWindowShortcut` default `'CommandOrControl+Shift+0'`.
- `CaptureMode` gains `'record-screen' | 'record-window'`. Tray gets "Record Screen…" and "Record Window…".
- System audio is requested as `{ echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 }` (V0 finding: Chromium voice-processes the loopback track by default).
- Bitrate is keyed off the preset (resolution × fps), never off `track.getSettings()`.
- Resolution presets are max boxes, aspect preserved, never upscaled, even dimensions: 1440 → 2560×1440, 1080 → 1920×1080, 720 → 1280×720.
- Max recording length stays 300 s (`WEBM_MAX_SECONDS` → `MAX_SECONDS`). Chunks stay in memory.
- Control bar (timer + Done/Cancel) unchanged. For screen/window it sits on the recorded display and WILL appear in the recording — accepted for V1, noted in ROADMAP.
- `npm test`, `npm run typecheck`, `npm run lint` green before every commit. Manual smoke steps run the dev app with an isolated profile: `npm run dev -- -- --user-data-dir=/tmp/snapkit-dev` (the production Snapkit.app holds the default profile's single-instance lock).

## File structure

| File | Responsibility |
|---|---|
| `src/shared/recordPlan.ts` (new) + test | Pure: `RecordResolution/RecordFps/RecordFormat` types, `RESOLUTION_BOX`, `outputSize()`, `videoBitrate()`, `pickMimeType()` |
| `src/shared/prefs.ts` + `prefs.test.ts` (new) | New pref fields/defaults; `normalizePrefs()` (gif → mp4 migration) |
| `src/shared/ipc.ts` | `CaptureMode` additions; `RecordJob` new shape; `RecordSource` |
| `src/main/prefs.ts` | `SHORTCUT_FIELDS` + two fields; `getPrefs()` runs `normalizePrefs` |
| `src/main/recorder.ts` | `RecordTarget` → job; `pendingSource` (display or window id + audio flag); display-media handler; mic permission; save filters |
| `src/renderer/src/recorder/main.ts` | Rewritten: constraints or canvas crop, audio merge, mime/bitrate, single format path |
| `src/main/capture.ts` | Dispatch `record-screen` / `record-window`; picker `purpose`; `startScreenRecording()` |
| `src/main/index.ts`, `src/main/tray.ts` | Two new handlers / menu entries |
| `src/renderer/src/PrefsPanel.tsx` | "Recording" rows: format, resolution, fps, mic, system audio, two shortcuts; `Segmented` accepts numbers |
| `src/renderer/src/App.tsx` | Record button title text |
| `electron-builder.yml` | `NSMicrophoneUsageDescription` |
| `README.md`, spec, `ROADMAP.md` | Docs |

---

### Task 1: `src/shared/recordPlan.ts` — pure sizing / bitrate / mime decisions

**Files:**
- Create: `src/shared/recordPlan.ts`
- Create: `src/shared/recordPlan.test.ts`

**Interfaces:**
- Produces (used by Tasks 2–5):
  ```ts
  export type RecordResolution = 'native' | 1440 | 1080 | 720
  export type RecordFps = 30 | 60
  export type RecordFormat = 'mp4' | 'webm'
  export interface Size { width: number; height: number }
  export const RESOLUTION_BOX: Record<Exclude<RecordResolution, 'native'>, Size>
  export function outputSize(source: Size, resolution: RecordResolution): Size
  export function videoBitrate(resolution: RecordResolution, fps: RecordFps): number   // bits per second
  export function pickMimeType(format: RecordFormat, isSupported: (mime: string) => boolean): { mimeType: string; ext: RecordFormat } | null
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/shared/recordPlan.test.ts
import { describe, expect, it } from 'vitest'
import { outputSize, pickMimeType, RESOLUTION_BOX, videoBitrate } from './recordPlan'

describe('outputSize', () => {
  it('native keeps the source size, rounded to even', () => {
    expect(outputSize({ width: 1001, height: 501 }, 'native')).toEqual({ width: 1002, height: 502 })
  })
  it('fits a Retina 16:10 screen into the 1080 box, aspect preserved', () => {
    // 3024x1964 → limited by height: 1964→1080 (×0.55) → width 1663 → even 1664
    expect(outputSize({ width: 3024, height: 1964 }, 1080)).toEqual({ width: 1664, height: 1080 })
  })
  it('fits a portrait region by height', () => {
    expect(outputSize({ width: 800, height: 1600 }, 720)).toEqual({ width: 360, height: 720 })
  })
  it('fits a very wide region by width', () => {
    expect(outputSize({ width: 3840, height: 400 }, 1080)).toEqual({ width: 1920, height: 200 })
  })
  it('never upscales', () => {
    expect(outputSize({ width: 1280, height: 720 }, 1080)).toEqual({ width: 1280, height: 720 })
  })
  it('never returns less than 2x2', () => {
    expect(outputSize({ width: 1, height: 1 }, 720)).toEqual({ width: 2, height: 2 })
  })
})

describe('RESOLUTION_BOX', () => {
  it('has the three preset boxes', () => {
    expect(RESOLUTION_BOX).toEqual({
      1440: { width: 2560, height: 1440 },
      1080: { width: 1920, height: 1080 },
      720: { width: 1280, height: 720 }
    })
  })
})

describe('videoBitrate', () => {
  it('follows the preset table (Mbps × 1e6)', () => {
    expect(videoBitrate(1080, 30)).toBe(8_000_000)
    expect(videoBitrate(1080, 60)).toBe(12_000_000)
    expect(videoBitrate(1440, 60)).toBe(20_000_000)
    expect(videoBitrate('native', 60)).toBe(25_000_000)
    expect(videoBitrate(720, 30)).toBe(5_000_000)
  })
})

describe('pickMimeType', () => {
  it('prefers mp4 with avc1+aac, then avc1, then plain mp4', () => {
    const only = (ok: string) => (m: string) => m === ok
    expect(pickMimeType('mp4', only('video/mp4;codecs=avc1,mp4a.40.2'))).toEqual({
      mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4'
    })
    expect(pickMimeType('mp4', only('video/mp4;codecs=avc1'))).toEqual({ mimeType: 'video/mp4;codecs=avc1', ext: 'mp4' })
    expect(pickMimeType('mp4', only('video/mp4'))).toEqual({ mimeType: 'video/mp4', ext: 'mp4' })
  })
  it('falls back to webm when no mp4 flavour is supported', () => {
    const webmOnly = (m: string) => m.startsWith('video/webm')
    expect(pickMimeType('mp4', webmOnly)).toEqual({ mimeType: 'video/webm;codecs=vp9,opus', ext: 'webm' })
  })
  it('webm prefers vp9+opus, then plain webm', () => {
    expect(pickMimeType('webm', (m) => m === 'video/webm')).toEqual({ mimeType: 'video/webm', ext: 'webm' })
  })
  it('returns null when nothing is supported', () => {
    expect(pickMimeType('mp4', () => false)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/shared/recordPlan.test.ts`
Expected: FAIL — `Failed to resolve import "./recordPlan"`.

- [ ] **Step 3: Implement**

```ts
// src/shared/recordPlan.ts
/**
 * Pure decisions for screen recording: output size per preset, bitrate per
 * preset × fps, MediaRecorder container choice. No DOM, no Electron — golden-tested.
 * Bitrate and size are keyed off the PRESET on purpose: Chromium's
 * track.getSettings() does not report the real captured size (V0 spike).
 */

export type RecordResolution = 'native' | 1440 | 1080 | 720
export type RecordFps = 30 | 60
export type RecordFormat = 'mp4' | 'webm'

export interface Size {
  width: number
  height: number
}

/** Preset = max box; the source is fitted inside, aspect preserved, never upscaled. */
export const RESOLUTION_BOX: Record<Exclude<RecordResolution, 'native'>, Size> = {
  1440: { width: 2560, height: 1440 },
  1080: { width: 1920, height: 1080 },
  720: { width: 1280, height: 720 }
}

// Even dimensions: H.264 4:2:0 needs them, and MediaRecorder rejects odd canvases on some GPUs.
const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

export function outputSize(source: Size, resolution: RecordResolution): Size {
  if (resolution === 'native') return { width: even(source.width), height: even(source.height) }
  const box = RESOLUTION_BOX[resolution]
  const scale = Math.min(1, box.width / source.width, box.height / source.height)
  return { width: even(source.width * scale), height: even(source.height * scale) }
}

// Mbps. ponytail: fixed table; content-adaptive bitrate if files come out too big/small.
const MBPS: Record<RecordResolution, Record<RecordFps, number>> = {
  native: { 30: 16, 60: 25 },
  1440: { 30: 12, 60: 20 },
  1080: { 30: 8, 60: 12 },
  720: { 30: 5, 60: 8 }
}

export function videoBitrate(resolution: RecordResolution, fps: RecordFps): number {
  return MBPS[resolution][fps] * 1_000_000
}

const CANDIDATES: Record<RecordFormat, string[]> = {
  mp4: ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4'],
  webm: ['video/webm;codecs=vp9,opus', 'video/webm']
}

/** First supported container for the wanted format; mp4 falls back to webm. */
export function pickMimeType(
  format: RecordFormat,
  isSupported: (mime: string) => boolean
): { mimeType: string; ext: RecordFormat } | null {
  const order: RecordFormat[] = format === 'mp4' ? ['mp4', 'webm'] : ['webm']
  for (const ext of order) {
    const mimeType = CANDIDATES[ext].find(isSupported)
    if (mimeType) return { mimeType, ext }
  }
  return null
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/shared/recordPlan.test.ts`
Expected: 12 passed.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/shared/recordPlan.ts src/shared/recordPlan.test.ts
git commit -m "feat(shared): pure recording plan — preset sizes, bitrates, container choice

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Prefs model — new fields, gif → mp4 migration, single-format recorder

Makes the data model land while keeping every consumer compiling: the recorder loses its GIF branch (GIF becomes a V3 export), the prefs panel row shows MP4/WebM, `gifenc` goes.

**Files:**
- Modify: `src/shared/prefs.ts`
- Create: `src/shared/prefs.test.ts`
- Modify: `src/main/prefs.ts` (`SHORTCUT_FIELDS`, `getPrefs`)
- Modify: `src/main/recorder.ts` (constants, ext, save filters)
- Modify: `src/renderer/src/recorder/main.ts` (delete GIF branch + import)
- Delete: `src/renderer/src/recorder/gifenc.d.ts`
- Modify: `src/renderer/src/PrefsPanel.tsx` (recording-format row labels only)
- Modify: `package.json` (`npm uninstall gifenc`)

**Interfaces:**
- Consumes: `RecordFormat`, `RecordResolution`, `RecordFps` from Task 1.
- Produces: `Prefs` fields listed in Global Constraints; `normalizePrefs(raw: Prefs): Prefs`; `ShortcutField` now includes `'recordScreenShortcut' | 'recordWindowShortcut'`.

- [ ] **Step 1: Failing test for the migration**

```ts
// src/shared/prefs.test.ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, normalizePrefs, type Prefs } from './prefs'

describe('normalizePrefs', () => {
  it('migrates the removed gif recording format to mp4', () => {
    const stored = { ...DEFAULT_PREFS, recordFormat: 'gif' } as unknown as Prefs
    expect(normalizePrefs(stored).recordFormat).toBe('mp4')
  })
  it('keeps webm', () => {
    expect(normalizePrefs({ ...DEFAULT_PREFS, recordFormat: 'webm' }).recordFormat).toBe('webm')
  })
  it('fills fields missing from an older store with defaults', () => {
    const partial = { theme: 'light' } as unknown as Prefs
    const p = normalizePrefs(partial)
    expect(p.theme).toBe('light')
    expect(p.recordResolution).toBe('native')
    expect(p.recordFps).toBe(30)
    expect(p.recordMic).toBe(false)
    expect(p.recordSystemAudio).toBe(true)
    expect(p.recordScreenShortcut).toBe('CommandOrControl+Shift+9')
    expect(p.recordWindowShortcut).toBe('CommandOrControl+Shift+0')
  })
})
```

Run: `npx vitest run src/shared/prefs.test.ts` → FAIL (`normalizePrefs` not exported).

- [ ] **Step 2: Prefs model**

In `src/shared/prefs.ts`:

```ts
import { DEFAULT_CAPTURE_SHORTCUT, DEFAULT_HISTORY_SHORTCUT } from './ipc'
import type { RecordFormat, RecordFps, RecordResolution } from './recordPlan'
```

Replace the `recordFormat` field + comment and add the new fields (keep the rest of the interface as is):

```ts
  /** Screen recording container. MP4 (H.264 + AAC) plays everywhere; WebM (VP9 + Opus) is smaller. */
  recordFormat: RecordFormat
  /** Output size preset: max box, aspect preserved, never upscaled. */
  recordResolution: RecordResolution
  recordFps: RecordFps
  /** Mix the microphone into recordings. */
  recordMic: boolean
  /** Mix system audio (what you hear) into recordings. */
  recordSystemAudio: boolean
  /** Electron accelerator for full-screen recording. */
  recordScreenShortcut: string
  /** Electron accelerator for window recording (opens the picker). */
  recordWindowShortcut: string
```

In `DEFAULT_PREFS` replace `recordFormat: 'webm',` with:

```ts
  recordFormat: 'mp4',
  recordResolution: 'native',
  recordFps: 30,
  recordMic: false,
  recordSystemAudio: true,
  recordScreenShortcut: 'CommandOrControl+Shift+9',
  recordWindowShortcut: 'CommandOrControl+Shift+0',
```

Append:

```ts
/**
 * Fill gaps from older stores and migrate removed values. 0.4.x could store
 * recordFormat 'gif'; GIF is now an export of the video editor, not a recording format.
 */
export function normalizePrefs(raw: Prefs): Prefs {
  const p: Prefs = { ...DEFAULT_PREFS, ...raw }
  if (p.recordFormat !== 'mp4' && p.recordFormat !== 'webm') p.recordFormat = 'mp4'
  return p
}
```

Run: `npx vitest run src/shared/prefs.test.ts` → 3 passed.

- [ ] **Step 3: Main prefs**

`src/main/prefs.ts`: import `normalizePrefs` and add the fields:

```ts
import { DEFAULT_PREFS, normalizePrefs, type Prefs, type PrefsSetResult } from '@shared/prefs'

export const SHORTCUT_FIELDS = [
  'captureShortcut',
  'fullscreenShortcut',
  'windowShortcut',
  'scrollingShortcut',
  'recordShortcut',
  'recordScreenShortcut',
  'recordWindowShortcut',
  'historyShortcut'
] as const

export function getPrefs(): Prefs {
  return normalizePrefs({ ...DEFAULT_PREFS, ...store.store })
}
```

`src/main/index.ts` builds `handlers: Record<ShortcutField, …>` — it will no longer compile until Task 5 adds the two entries. To keep this task green, add them now pointing at the existing area recording (Task 5 replaces them):

```ts
      recordScreenShortcut: () => startCapture('record', host),
      recordWindowShortcut: () => startCapture('record', host),
```

- [ ] **Step 4: Recorder — one format path**

`src/main/recorder.ts`: replace the two constants and the `ext` logic:

```ts
const MAX_SECONDS = 300
```
- In `startRecording`: `const maxSeconds = MAX_SECONDS` (delete the gif ternary).
- In the `RecordSession` construction: `ext: format` (the format IS the extension now).
- `saveRecording` filters:
```ts
    filters: [
      ext === 'webm'
        ? { name: 'WebM video', extensions: ['webm'] }
        : { name: 'MP4 video', extensions: ['mp4'] }
    ]
```
`RecordJob.format` in `src/shared/ipc.ts` becomes `format: RecordFormat` (import the type from `./recordPlan`).

`src/renderer/src/recorder/main.ts`: delete the `gifenc` import, `GIF_FPS`, `GIF_MAX_WIDTH`, the `scale`/`willReadFrequently` gif branches and the whole `if (job.format === 'gif') { … }` block. `canvas.width = Math.max(2, sw)`, `canvas.height = Math.max(2, sh)`. The error fallback sends `job.format` as ext. The MediaRecorder branch stays as is for now (Task 3 rewrites the file).

```bash
git rm -q src/renderer/src/recorder/gifenc.d.ts
npm uninstall gifenc
```

- [ ] **Step 5: Prefs panel row**

In `src/renderer/src/PrefsPanel.tsx` replace the "Recording format" options:

```tsx
              options={[
                { value: 'mp4', label: 'MP4' },
                { value: 'webm', label: 'WebM' }
              ]}
```

- [ ] **Step 6: Verify, commit**

Run: `npm run typecheck && npm run lint && npm test` → all pass (63 existing + 12 recordPlan + 3 prefs = 78); `grep -rn gifenc src package.json` → nothing.

```bash
git add -A src/shared/prefs.ts src/shared/prefs.test.ts src/shared/ipc.ts src/main/prefs.ts src/main/index.ts src/main/recorder.ts src/renderer/src/recorder src/renderer/src/PrefsPanel.tsx package.json package-lock.json
git commit -m "feat(prefs): recording presets and audio prefs; mp4 default; drop gif recording

GIF becomes an export of the video editor (V3). Stored 'gif' migrates to mp4.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Recorder pipeline — job model, presets, audio (area source)

**Files:**
- Modify: `src/shared/ipc.ts` (`RecordJob`, `RecordSource`)
- Modify: `src/main/recorder.ts` (job from prefs, `pendingSource` with audio, handler)
- Rewrite: `src/renderer/src/recorder/main.ts`

**Interfaces:**
- Consumes: Task 1 (`outputSize`, `RESOLUTION_BOX`, `videoBitrate`, `pickMimeType`), Task 2 prefs.
- Produces:
  ```ts
  // src/shared/ipc.ts
  export type RecordSource = 'area' | 'screen' | 'window'
  export interface RecordJob {
    source: RecordSource
    /** area only: selection in display CSS px. */
    rect?: Rect
    /** DIP size of the display being recorded (maps video px → rect px). */
    displaySize: { width: number; height: number }
    format: RecordFormat
    resolution: RecordResolution
    fps: RecordFps
    mic: boolean
    systemAudio: boolean
    /** Hard stop after this many seconds. */
    maxSeconds: number
  }
  ```
  Deviation from the spec text: the container (`mimeType`) is chosen in the renderer via `pickMimeType` + `MediaRecorder.isTypeSupported` (a renderer-only API), not carried in `RecordJob`; the renderer reports the resulting extension through `recordResult`. Update the spec's V1 `RecordJob` bullet accordingly in Task 6.
  `src/main/recorder.ts`: `export type RecordTarget = { source: 'area'; display: Display; rect: Rect } | { source: 'screen'; display: Display } | { source: 'window'; display: Display; sourceId: string }` and `export function startRecording(target: RecordTarget): void`. Task 4 adds the screen/window callers; this task only wires `area`.

- [ ] **Step 1: IPC types**

In `src/shared/ipc.ts` add `import type { RecordFormat, RecordFps, RecordResolution } from './recordPlan'` and replace the `RecordJob` interface with the one above (also add `export type RecordSource`).

- [ ] **Step 2: Main — target → job, handler with audio**

Replace the top of `src/main/recorder.ts` (imports through `setupDisplayMediaHandler`) with:

```ts
import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  session as electronSession,
  shell,
  type Display
} from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { IpcChannels, type Rect, type RecordJob } from '@shared/ipc'
import { getPrefs } from './prefs'
import { createControlBar, sendControlStatus } from './controlbar'
import { APP_URL } from './protocol'
import type { EditorHost } from './capture'

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']

const MAX_SECONDS = 300

/** What to record. `display` is where the control bar goes and, for area/screen, what is captured. */
export type RecordTarget =
  | { source: 'area'; display: Display; rect: Rect }
  | { source: 'screen'; display: Display }
  | { source: 'window'; display: Display; sourceId: string }

interface RecordSession {
  recorder: BrowserWindow
  control: BrowserWindow
  timer: NodeJS.Timeout
  startedAt: number
  ext: string
  stopping: boolean
}

let current: RecordSession | null = null
/** What the in-flight getDisplayMedia request should receive (set by startRecording). */
let pendingSource: { displayId: number; sourceId?: string; audio: boolean } | null = null

/** Route the recorder's getDisplayMedia() to the chosen display or window, no picker. */
export function setupDisplayMediaHandler(): void {
  electronSession.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    const pending = pendingSource
    desktopCapturer
      .getSources({ types: pending?.sourceId ? ['window', 'screen'] : ['screen'] })
      .then((sources) => {
        const match = pending?.sourceId
          ? sources.find((s) => s.id === pending.sourceId)
          : (sources.find((s) => s.display_id === String(pending?.displayId)) ?? sources[0])
        if (!match) return callback({})
        // 'loopback' = system audio. Works on macOS 13+ and Windows (V0 spike).
        callback(pending?.audio ? { video: match, audio: 'loopback' } : { video: match })
      })
      .catch(() => callback({}))
  })
}
```

Replace `startRecording(display, rect)` with:

```ts
export function startRecording(target: RecordTarget): void {
  if (current) return
  const prefs = getPrefs()
  const { display } = target

  pendingSource = {
    displayId: display.id,
    sourceId: target.source === 'window' ? target.sourceId : undefined,
    audio: prefs.recordSystemAudio
  }

  const recorder = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Control bar: under the area, or on the recorded display for screen/window.
  // ponytail: for screen/window the bar is inside the recording — see ROADMAP.
  const region =
    target.source === 'area'
      ? {
          x: display.bounds.x + Math.round(target.rect.x),
          y: display.bounds.y + Math.round(target.rect.y),
          width: Math.round(target.rect.width),
          height: Math.round(target.rect.height)
        }
      : display.bounds
  const control = createControlBar('record', region)

  const job: RecordJob = {
    source: target.source,
    rect: target.source === 'area' ? target.rect : undefined,
    displaySize: { width: display.size.width, height: display.size.height },
    format: prefs.recordFormat,
    resolution: prefs.recordResolution,
    fps: prefs.recordFps,
    mic: prefs.recordMic,
    systemAudio: prefs.recordSystemAudio,
    maxSeconds: MAX_SECONDS
  }
  recorder.webContents.once('did-finish-load', () => {
    recorder.webContents.send(IpcChannels.recordStart, job)
  })
  void recorder.loadURL(
    RENDERER_DEV_URL ? `${RENDERER_DEV_URL}/recorder.html` : `${APP_URL}/recorder.html`
  )

  const startedAt = Date.now()
  const timer = setInterval(() => {
    if (!current) return
    const elapsed = Math.floor((Date.now() - startedAt) / 1000)
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
    const ss = String(elapsed % 60).padStart(2, '0')
    sendControlStatus(current.control, `${mm}:${ss}`)
    if (elapsed >= MAX_SECONDS) stopRecording()
  }, 500)

  const onDied = (): void => {
    if (current && (current.recorder.isDestroyed() || current.control.isDestroyed())) {
      teardown()
    }
  }
  recorder.on('closed', onDied)
  control.on('closed', onDied)

  current = { recorder, control, timer, startedAt, ext: prefs.recordFormat, stopping: false }
}
```

In `teardown()` replace `pendingDisplayId = null` with `pendingSource = null`. `registerRecorderIpc`, `stopRecording`, `cancelRecording`, `saveRecording` unchanged. The `recordResult` handler already uses the `ext` the renderer sends — keep that (the renderer may fall back from mp4 to webm).

`src/main/capture.ts` `finishSelection`: `else startRecording(display, rect)` → `else startRecording({ source: 'area', display, rect })`.

- [ ] **Step 3: Renderer — rewrite `src/renderer/src/recorder/main.ts`**

```ts
import type { Rect, RecordJob } from '@shared/ipc'
import { outputSize, pickMimeType, RESOLUTION_BOX, videoBitrate } from '@shared/recordPlan'

/**
 * Hidden recorder page. Main picks the source (display or window) in its
 * DisplayMediaRequestHandler; this page:
 *   - screen/window: records the track directly, downscaled by constraints
 *     (aspect-preserving fit into the preset box — no canvas, no CPU cost)
 *   - area: full-resolution track → canvas crop scaled to the preset → captureStream
 *   - audio: system (loopback, requested raw/stereo) and/or mic, merged with an
 *     AudioContext when both are present
 *   - MediaRecorder mp4 (H.264+AAC) — falls back to webm if unsupported
 */

let stopRequested = false
let stopFn: (() => void) | null = null

window.recorderApi.onStop(() => {
  stopRequested = true
  stopFn?.()
})

window.recorderApi.onStart((job) => {
  void record(job).catch((err) => {
    console.error('[recorder]', err)
    // Empty result → main tears the session down instead of hanging.
    window.recorderApi.sendResult(new ArrayBuffer(0), job.format)
  })
})

const RAW_STEREO: MediaTrackConstraints = {
  // Chromium voice-processes the loopback track by default (mono, AGC, NS, AEC) — V0 spike.
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 2
}

async function record(job: RecordJob): Promise<void> {
  // Screen/window: let Chromium downscale into the preset box. Area: full-res track, canvas crops.
  const box =
    job.source !== 'area' && job.resolution !== 'native' ? RESOLUTION_BOX[job.resolution] : undefined
  const display = await navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: job.fps,
      ...(box ? { width: { max: box.width }, height: { max: box.height } } : {})
    },
    audio: job.systemAudio ? RAW_STEREO : false
  })
  const mic = job.mic
    ? await navigator.mediaDevices.getUserMedia({ audio: true }).catch((err: unknown) => {
        console.warn('[recorder] microphone unavailable, recording without it', err)
        return null
      })
    : null

  const screenTrack = display.getVideoTracks()[0]
  // The recorded window was closed / share ended → finish what we have.
  screenTrack.addEventListener('ended', () => {
    stopRequested = true
    stopFn?.()
  })

  let videoTrack = screenTrack
  let stopCanvas = (): void => {}
  if (job.source === 'area' && job.rect) {
    const crop = await cropToCanvas(display, job, job.rect)
    videoTrack = crop.track
    stopCanvas = crop.stop
  }

  const audioCtx = new AudioContext()
  const audioTrack = mergeAudio(audioCtx, display.getAudioTracks()[0], mic?.getAudioTracks()[0])
  const stream = new MediaStream(audioTrack ? [videoTrack, audioTrack] : [videoTrack])

  const mime = pickMimeType(job.format, (m) => MediaRecorder.isTypeSupported(m))
  if (!mime) throw new Error('MediaRecorder supports neither mp4 nor webm here')

  const recorder = new MediaRecorder(stream, {
    mimeType: mime.mimeType,
    videoBitsPerSecond: videoBitrate(job.resolution, job.fps),
    audioBitsPerSecond: 128_000
  })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  const done = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })
  recorder.start(1000)

  await new Promise<void>((resolve) => {
    stopFn = resolve
    if (stopRequested) resolve()
  })
  recorder.stop()
  await done

  stopCanvas()
  display.getTracks().forEach((t) => t.stop())
  mic?.getTracks().forEach((t) => t.stop())
  await audioCtx.close()

  const blob = new Blob(chunks, { type: mime.mimeType })
  window.recorderApi.sendResult(await blob.arrayBuffer(), mime.ext)
}

/** Area recording: draw the selected region of the full-res track onto a preset-sized canvas. */
async function cropToCanvas(
  display: MediaStream,
  job: RecordJob,
  rect: Rect
): Promise<{ track: MediaStreamTrack; stop: () => void }> {
  const video = document.createElement('video')
  video.srcObject = display
  video.muted = true
  await video.play()

  // Map the DIP selection onto video pixels (the track is HiDPI-sized).
  const fx = video.videoWidth / job.displaySize.width
  const fy = video.videoHeight / job.displaySize.height
  const sx = Math.max(0, Math.round(rect.x * fx))
  const sy = Math.max(0, Math.round(rect.y * fy))
  const sw = Math.min(Math.round(rect.width * fx), video.videoWidth - sx)
  const sh = Math.min(Math.round(rect.height * fy), video.videoHeight - sy)

  const canvas = document.createElement('canvas')
  const out = outputSize({ width: sw, height: sh }, job.resolution)
  canvas.width = out.width
  canvas.height = out.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')

  let raf = 0
  const draw = (): void => {
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    raf = requestAnimationFrame(draw)
  }
  draw()

  const track = canvas.captureStream(job.fps).getVideoTracks()[0]
  return { track, stop: () => cancelAnimationFrame(raf) }
}

/** One audio track out of up to two: pass-through for one source, mixed for two. */
function mergeAudio(
  ctx: AudioContext,
  system?: MediaStreamTrack,
  mic?: MediaStreamTrack
): MediaStreamTrack | undefined {
  if (!system || !mic) return system ?? mic
  const dest = ctx.createMediaStreamDestination()
  for (const t of [system, mic]) ctx.createMediaStreamSource(new MediaStream([t])).connect(dest)
  return dest.stream.getAudioTracks()[0]
}
```

- [ ] **Step 4: Typecheck, lint, tests, manual smoke (area)**

Run: `npm run typecheck && npm run lint && npm test` → green.

Manual (you at the Mac; the production Snapkit may keep running):
```bash
npm run dev -- -- --user-data-dir=/tmp/snapkit-dev
```
1. Preferences → Recording format MP4 (default). Tray → Record Area…, select a region, wait 5 s, Done. Save dialog offers `.mp4`. Open the file in QuickTime: plays, has audio if something was playing (system audio default on).
2. Repeat with format WebM → `.webm` saves and plays in Chrome/VLC.
3. `ffprobe`-less check of the real size: open the mp4 in QuickTime → ⌘I shows the dimensions; area 1000×600 DIP on Retina with preset Native → 2000×1200.
Record what you saw in the commit body.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc.ts src/main/recorder.ts src/main/capture.ts src/renderer/src/recorder/main.ts
git commit -m "feat(recorder): mp4 output, presets, system+mic audio for area recordings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Full-screen and window recording sources

**Files:**
- Modify: `src/shared/ipc.ts` (`CaptureMode`)
- Modify: `src/main/capture.ts`

**Interfaces:**
- Consumes: `startRecording(target: RecordTarget)` from Task 3.
- Produces: `startCapture('record-screen' | 'record-window', host)` works end to end.

- [ ] **Step 1: `CaptureMode`**

`src/shared/ipc.ts`:
```ts
export type CaptureMode =
  | 'area'
  | 'fullscreen'
  | 'window'
  | 'scrolling'
  | 'record'
  | 'record-screen'
  | 'record-window'
```

- [ ] **Step 2: capture.ts dispatch + picker purpose + screen recording**

```ts
interface PickerSession {
  picker: BrowserWindow
  restoreMain: boolean
  purpose: 'capture' | 'record'
}
```

`startCapture` switch — add before `default`:
```ts
    case 'record-screen':
      void startScreenRecording(host)
      break
    case 'record-window':
      void startWindowCapture(host, 'record')
      break
```

New function (place after `startFullscreenCapture`):
```ts
/** Record the display under the cursor; no selection UI. */
export async function startScreenRecording(host: EditorHost): Promise<void> {
  if (busy) return
  busy = true
  const prep = await prepare(host)
  busy = false
  if (!prep) return
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  startRecording({ source: 'screen', display })
}
```

`startWindowCapture` gains the purpose parameter and stores it:
```ts
export async function startWindowCapture(
  host: EditorHost,
  purpose: 'capture' | 'record' = 'capture'
): Promise<void> {
  …
    pickerSession = { picker, restoreMain: prep.restoreMain, purpose }
```

`finishWindowPick`: read the purpose before the session is cleared and branch:
```ts
async function finishWindowPick(id: string, host: EditorHost): Promise<void> {
  if (!pickerSession) return
  const { picker, purpose } = pickerSession
  pickerSession = null
  picker.destroy()
  busy = false

  if (purpose === 'record') {
    // The recorder captures the window live via its source id; the display only
    // decides where the control bar goes.
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    startRecording({ source: 'window', display, sourceId: id })
    return
  }

  try {
    // Re-grab the chosen window at high resolution.
    …unchanged…
```

- [ ] **Step 3: Typecheck, lint, manual smoke**

Run: `npm run typecheck && npm run lint && npm test` → green.

Manual (`npm run dev -- -- --user-data-dir=/tmp/snapkit-dev`) — the tray has no entries yet (Task 5), so trigger from the home window's devtools console: `window.api.startCapture('record-screen')` and `window.api.startCapture('record-window')`.
1. Screen: control bar appears at the top of the display, timer runs, Done → `.mp4` that shows the whole display (control bar visible in it — expected).
2. Window: picker opens, choose a window, Done → `.mp4` with only that window's content, even if another window overlapped it.
3. Preferences → Resolution 720 → screen recording → QuickTime ⌘I shows ≤1280×720 (e.g. 1108×720 on a 16:10 display).
4. Close the recorded window mid-recording → recording stops by itself and saves.

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc.ts src/main/capture.ts
git commit -m "feat(recorder): full-screen and window recording sources

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Entry points and preferences UI

**Files:**
- Modify: `src/main/index.ts` (handlers, tray actions)
- Modify: `src/main/tray.ts`
- Modify: `src/renderer/src/PrefsPanel.tsx`
- Modify: `src/renderer/src/App.tsx` (title text)

- [ ] **Step 1: Handlers + tray**

`src/main/index.ts` — replace the two placeholder handlers from Task 2:
```ts
      recordScreenShortcut: () => startCapture('record-screen', host),
      recordWindowShortcut: () => startCapture('record-window', host),
```
and in `createTray({...})` add after `recordArea`:
```ts
        recordScreen: handlers.recordScreenShortcut,
        recordWindow: handlers.recordWindowShortcut,
```

`src/main/tray.ts`:
```ts
export interface TrayActions {
  show: () => void
  captureArea: () => void
  captureFullscreen: () => void
  captureWindow: () => void
  captureScrolling: () => void
  recordArea: () => void
  recordScreen: () => void
  recordWindow: () => void
  clipboardHistory: () => void
  quit: () => void
}

type TrayShortcuts = Pick<
  Prefs,
  | 'captureShortcut'
  | 'fullscreenShortcut'
  | 'windowShortcut'
  | 'scrollingShortcut'
  | 'recordShortcut'
  | 'recordScreenShortcut'
  | 'recordWindowShortcut'
  | 'historyShortcut'
>
```
Menu — replace the single `Record Area…` item with:
```ts
    { type: 'separator' },
    { label: 'Record Area…', accelerator: shortcuts.recordShortcut, click: actions.recordArea },
    {
      label: 'Record Screen',
      accelerator: shortcuts.recordScreenShortcut,
      click: actions.recordScreen
    },
    {
      label: 'Record Window…',
      accelerator: shortcuts.recordWindowShortcut,
      click: actions.recordWindow
    },
```

- [ ] **Step 2: Prefs panel**

`Segmented` must accept numeric values:
```tsx
function Segmented<T extends string | number>({
  …
        <button
          key={String(o.value)}
```

Shortcut rows — after the "Record area" row:
```tsx
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
```

Recording rows — right after the "Recording format" row:
```tsx
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
```

`src/renderer/src/App.tsx` — the Record button title:
```ts
                  title: 'Record an area of the screen (MP4 — presets in Preferences)'
```

- [ ] **Step 3: Verify, smoke, commit**

Run: `npm run typecheck && npm run lint && npm test` → green.
Manual: tray shows the three Record entries with ⇧⌘7 / ⇧⌘9 / ⇧⌘0; the shortcuts trigger; Preferences shows the new rows and each change persists after restart (`--user-data-dir=/tmp/snapkit-dev` keeps its own store).

```bash
git add src/main/index.ts src/main/tray.ts src/renderer/src/PrefsPanel.tsx src/renderer/src/App.tsx
git commit -m "feat(recorder): tray entries, shortcuts and preferences for recording presets

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Microphone permission, packaging entitlement, docs

**Files:**
- Modify: `src/main/recorder.ts` (mic permission before starting)
- Modify: `electron-builder.yml` (`mac.extendInfo`)
- Modify: `README.md`, `ROADMAP.md`, spec §3 V1

- [ ] **Step 1: Ask for the microphone on macOS, degrade gracefully**

`src/main/recorder.ts`: add `Notification, systemPreferences` to the electron import. Make `startRecording` async-safe without changing its signature — wrap the body:

```ts
export function startRecording(target: RecordTarget): void {
  if (current) return
  void begin(target)
}

async function begin(target: RecordTarget): Promise<void> {
  const prefs = getPrefs()
  let mic = prefs.recordMic
  if (mic && process.platform === 'darwin') {
    // First call shows the OS prompt (needs NSMicrophoneUsageDescription in the bundle).
    mic = await systemPreferences.askForMediaAccess('microphone')
    if (!mic) {
      new Notification({
        title: 'Recording without microphone',
        body: 'Allow Snapkit in System Settings → Privacy & Security → Microphone to include your voice.'
      }).show()
    }
  }
  if (current) return
  // …then the whole existing body of startRecording from `pendingSource = {` to the
  // final `current = {…}` assignment, moved here verbatim, with ONE change in the job:
  //   mic,            // instead of mic: prefs.recordMic
}
```

- [ ] **Step 2: Bundle entitlement string**

`electron-builder.yml` under `mac:` add:
```yaml
  extendInfo:
    NSMicrophoneUsageDescription: Snapkit records your microphone only when you enable it for screen recordings.
```

- [ ] **Step 3: Docs**

`README.md` — "Record" section (around line 62):
```markdown
**Record**

- Area, full screen or window → **MP4** (H.264 + AAC) or WebM, up to 5 min
- Resolution presets (native / 1440p / 1080p / 720p), 30 or 60 fps
- System audio (macOS 13+, Windows) and/or microphone
```
Update the prefs sentence (line ~74): "recording format" → "recording format, resolution, frame rate and audio". In the entry-points table (line ~140) change the row `| Scrolling capture / Record | tray menu or home buttons |` to `| Scrolling capture / Record area, screen, window | tray menu, shortcuts or home buttons |`.

`ROADMAP.md` — 3.1 row: `V1 recorder ✅`; add under "Deferred technical debt": "Control bar is visible in screen/window recordings — Electron cannot exclude a window from ScreenCaptureKit/WGC capture; options: move the bar to another display when present, or a tray-only timer."

Spec §3 V1: add a "Landed" line: mic prompt + notification, entitlement, control-bar-in-recording note.

- [ ] **Step 4: Verify, package, commit**

Run: `npm run typecheck && npm run lint && npm test` → green.
Run: `npm run package` → then in the packaged app (`SNAPKIT_SPIKE` no longer exists; just launch `dist/mac-arm64/Snapkit.app/Contents/MacOS/Snapkit --user-data-dir=/tmp/snapkit-pkg`): enable "Record microphone", Record Screen → macOS microphone prompt appears once; deny → notification, recording proceeds without mic; allow → recording has the mic mixed in.

```bash
git add src/main/recorder.ts electron-builder.yml README.md ROADMAP.md docs/superpowers/specs/2026-09-03-video-suite-design.md
git commit -m "feat(recorder): microphone permission flow, bundle usage string, docs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 5: Final verification**

`git status --short` clean; `npm test && npm run typecheck && npm run lint` green; one 30 s 1080p60 screen recording with system audio plays in QuickTime and VLC. V1 done → V3 (editor) is next; V2 (replay) after it.
