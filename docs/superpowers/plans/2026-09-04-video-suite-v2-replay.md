# Video Suite V2 — Replay buffer / game clips — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Save the last N seconds" from a global hotkey: a background buffer records the screen continuously into 10 s segments and, on ⌘⇧8, concatenates the newest ones into a clip in under two seconds.

**Architecture:** A hidden `replay.html` renderer holds one `getDisplayMedia` stream and rotates a `MediaRecorder` every 10 s (the next recorder starts before the previous stops, so no frame is lost). Each segment goes to main as bytes and lands in a temp ring on disk trimmed by cumulative duration. On the hotkey main asks the renderer to flush the in-progress segment, writes an ffmpeg concat list and stream-copies the tail into `clipsDir` via V0's `runFfmpeg` + `concatArgs`. Capture setup (constraints, audio mixing, mime/bitrate) is extracted from the V1 recorder into a shared renderer module so both windows use identical code. Also lands the ROADMAP prerequisite: a second way to stop a recording (tray "Stop Recording" + record shortcuts toggle).

**Tech Stack:** Electron 43 (`powerMonitor`, `screen`, `Notification`, `Tray`), electron-vite 5, React 19 prefs UI, vitest 4, bundled ffmpeg 9.0.1 via `src/main/ffmpeg.ts`, V0 `src/shared/videoArgs.ts` (`concatArgs(listFile, output, fromSec?)`). No new dependencies.

Spec: `docs/superpowers/specs/2026-09-03-video-suite-design.md` §3 V2 + §5.

Branch: `claude/snapkit-video-suite-v2` from the V3 branch head (`claude/snapkit-video-suite-v3`, PR #12). Stacked.

## Global Constraints

- Prefs (exact names/defaults): `replayBuffer: 0 | 30 | 60 | 120 | 300` default `0` (off); `replayShortcut` default `'CommandOrControl+Shift+8'`; `clipsDir: string | null` default `null` = `<videos>/Snapkit Clips` (`app.getPath('videos')` → `~/Movies` on macOS, `Videos` on Windows/Linux); `clipOpenInEditor: boolean` default `false`.
- Segment length 10 s; ring keeps the newest segments whose cumulative duration covers `keepSec` plus one more segment; everything older is unlinked. Ring lives in `app.getPath('temp')/snapkit-replay/`.
- Buffer records the **display under the cursor at start**; records full screen only; format follows the recorder's mime choice (mp4 preferred, webm fallback — all segments in one run share it).
- Hotkey → flash + Notification "Saving clip…" → flush in-progress segment (wait ≤ 5 s) → concat list → `runFfmpeg(concatArgs(list, out, totalSec − keepSec))` → `Snapkit Clip YYYY-MM-DD at HH.MM.SS.<ext>` in `clipsDir` → Notification "Clip saved" (click → reveal) or open in the editor when `clipOpenInEditor`.
- Buffer restarts itself after renderer death, system resume and display removal while the pref is on; stopping the pref tears the window down and empties the ring.
- Tray: icon swaps to a recording variant (grey glyph + red dot, non-template) while the buffer runs or a recording is in progress; menu gets "Save Replay (N s)" (enabled only when the buffer runs) and "Stop Recording" (enabled only while recording). Record shortcuts toggle: pressing one while a recording runs stops it.
- Manual recordings and the buffer are independent sessions (two hidden windows, no shared state) — the display-media routing becomes one-shot per request.
- `npm test`, `npm run typecheck`, `npm run lint` green before every commit. Manual smoke: `npm run dev -- -- --user-data-dir=/tmp/snapkit-dev`.

## File structure

| File | Responsibility |
|---|---|
| `src/shared/replayPlan.ts` (+test) | Pure: `ReplaySeconds`, `REPLAY_SECONDS`, `SEGMENT_SEC`, `ringTrim`, `clipStartSec`, `concatListText`, `clipFileName` |
| `src/shared/prefs.ts` (+test), `src/shared/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/env.d.ts` | prefs fields, `ReplayJob`, channels, `ReplayApi` |
| `src/renderer/src/recorder/capture.ts` (new) | `setupCapture()` extracted from `recorder/main.ts`; both windows use it |
| `src/renderer/replay.html`, `src/renderer/src/replay/main.ts` | segment loop |
| `src/main/replay.ts` | buffer lifecycle, ring on disk, flush, clip save, notifications |
| `src/main/recorder.ts` | `setPendingSource()` one-shot routing; `isRecording()`, `stopCurrentRecording()`, `onRecordingStateChange()` |
| `src/main/tray.ts`, `scripts/make-tray-icon.mjs`, `resources/tray-icon-rec.png(@2x)` | state icon, new items |
| `src/main/index.ts`, `src/main/prefs.ts` | wiring, `SHORTCUT_FIELDS` |
| `src/renderer/src/PrefsPanel.tsx` | Replay section |
| `README.md`, `ROADMAP.md`, spec | docs |

---

### Task 1: `src/shared/replayPlan.ts` — pure ring / clip helpers

**Files:**
- Create: `src/shared/replayPlan.ts`, `src/shared/replayPlan.test.ts`

**Interfaces (produces):**
```ts
export type ReplaySeconds = 0 | 30 | 60 | 120 | 300
export const REPLAY_SECONDS: readonly ReplaySeconds[]     // [0, 30, 60, 120, 300]
export const SEGMENT_SEC = 10
export interface Segment { path: string; durationMs: number }
/** Newest-last input. Keeps the newest segments whose total covers keepMs, plus one more. */
export function ringTrim(segments: Segment[], keepMs: number): { keep: Segment[]; drop: Segment[] }
/** Where the clip starts inside the concatenation so that exactly keepMs remain (never negative). */
export function clipStartSec(totalMs: number, keepMs: number): number
/** ffmpeg concat demuxer list; single quotes escaped as '\'' . */
export function concatListText(paths: string[]): string
export function clipFileName(d: Date, ext: string): string   // "Snapkit Clip 2026-09-04 at 14.05.09.mp4"
```

- [ ] **Step 1: Failing tests**

```ts
// src/shared/replayPlan.test.ts
import { describe, expect, it } from 'vitest'
import { clipFileName, clipStartSec, concatListText, REPLAY_SECONDS, ringTrim, SEGMENT_SEC } from './replayPlan'

const seg = (i: number, durationMs = 10_000) => ({ path: `seg-${i}.mp4`, durationMs })

describe('constants', () => {
  it('exposes the preset list and the segment length', () => {
    expect(REPLAY_SECONDS).toEqual([0, 30, 60, 120, 300])
    expect(SEGMENT_SEC).toBe(10)
  })
})

describe('ringTrim', () => {
  it('keeps enough newest segments to cover keepMs plus one extra', () => {
    const all = [1, 2, 3, 4, 5, 6].map((i) => seg(i))
    const { keep, drop } = ringTrim(all, 30_000)
    // 30 s needs 3 segments; +1 safety = 4 newest
    expect(keep.map((s) => s.path)).toEqual(['seg-3.mp4', 'seg-4.mp4', 'seg-5.mp4', 'seg-6.mp4'])
    expect(drop.map((s) => s.path)).toEqual(['seg-1.mp4', 'seg-2.mp4'])
  })
  it('counts real durations, so short flush segments do not shrink the window', () => {
    const all = [seg(1), seg(2), seg(3), seg(4, 1_500)]
    const { keep } = ringTrim(all, 30_000)
    // 1.5 + 10 + 10 = 21.5 < 30 → need seg-1 too, +1 extra is none left
    expect(keep.map((s) => s.path)).toEqual(['seg-1.mp4', 'seg-2.mp4', 'seg-3.mp4', 'seg-4.mp4'])
  })
  it('keeps everything while the buffer is still filling', () => {
    const { keep, drop } = ringTrim([seg(1)], 60_000)
    expect(keep).toHaveLength(1)
    expect(drop).toHaveLength(0)
  })
  it('preserves order (oldest first)', () => {
    const { keep } = ringTrim([seg(1), seg(2), seg(3)], 10_000)
    expect(keep.map((s) => s.path)).toEqual(['seg-2.mp4', 'seg-3.mp4'])
  })
})

describe('clipStartSec', () => {
  it('seeks so that keepMs remain', () => expect(clipStartSec(45_000, 30_000)).toBe(15))
  it('never goes negative while the buffer is filling', () => expect(clipStartSec(12_000, 30_000)).toBe(0))
})

describe('concatListText', () => {
  it('writes one file directive per line and escapes single quotes', () => {
    expect(concatListText(['/tmp/a.mp4', "/tmp/o'neil.mp4"])).toBe(
      "file '/tmp/a.mp4'\nfile '/tmp/o'\\''neil.mp4'\n"
    )
  })
})

describe('clipFileName', () => {
  it('formats like the other Snapkit file names', () => {
    expect(clipFileName(new Date(2026, 8, 4, 14, 5, 9), 'mp4')).toBe('Snapkit Clip 2026-09-04 at 14.05.09.mp4')
  })
})
```

- [ ] **Step 2: Run** `npx vitest run src/shared/replayPlan.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/shared/replayPlan.ts
/** Pure helpers for the replay buffer (ring of recorded segments → clip). */

export type ReplaySeconds = 0 | 30 | 60 | 120 | 300
export const REPLAY_SECONDS: readonly ReplaySeconds[] = [0, 30, 60, 120, 300]
export const SEGMENT_SEC = 10

export interface Segment {
  path: string
  durationMs: number
}

/**
 * Walk from the newest segment back until the kept duration covers keepMs,
 * then keep one more (the clip start usually falls inside a segment).
 * ponytail: one frame lost per boundary is avoided by overlapping recorders in the
 * renderer; the extra segment is why the ring costs keepSec + 10 s of disk.
 */
export function ringTrim(segments: Segment[], keepMs: number): { keep: Segment[]; drop: Segment[] } {
  let covered = 0
  let cut = segments.length
  for (let i = segments.length - 1; i >= 0; i--) {
    cut = i
    covered += segments[i].durationMs
    if (covered >= keepMs) break
  }
  const from = Math.max(0, cut - 1)
  return { keep: segments.slice(from), drop: segments.slice(0, from) }
}

export function clipStartSec(totalMs: number, keepMs: number): number {
  return Math.max(0, (totalMs - keepMs) / 1000)
}

export function concatListText(paths: string[]): string {
  return paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'\n`).join('')
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

export function clipFileName(d: Date, ext: string): string {
  return `Snapkit Clip ${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} at ${pad2(d.getHours())}.${pad2(d.getMinutes())}.${pad2(d.getSeconds())}.${ext}`
}
```

- [ ] **Step 4: Run** → 9 passed. Check the "short flush segment" case by hand: walking back 1.5 + 10 + 10 = 21.5 < 30 → include seg-1 → covered 31.5 ≥ 30 at i = 0 → cut 0 → from 0 → keep all four ✓. First case: 10+10+10 ≥ 30 at i = 3 → cut 3 → from 2 → keep indices 2..5 ✓.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/shared/replayPlan.ts src/shared/replayPlan.test.ts
git commit -m "feat(shared): replay ring helpers (trim by duration, clip start, concat list, clip name)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Prefs, IPC and preload for the replay buffer

**Files:**
- Modify: `src/shared/prefs.ts`, `src/shared/prefs.test.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/prefs.ts` (`SHORTCUT_FIELDS`)
- Modify: `src/main/index.ts` (placeholder handler so `Record<ShortcutField,…>` compiles — Task 4 replaces it)
- Modify: `src/preload/index.ts`, `src/renderer/src/env.d.ts`

**Interfaces (produces):**
```ts
// prefs
replayBuffer: ReplaySeconds; replayShortcut: string; clipsDir: string | null; clipOpenInEditor: boolean
// ipc.ts
replayStart: 'replay:start'      // main → replay renderer: ReplayJob
replayStop: 'replay:stop'        // main → replay renderer
replayFlush: 'replay:flush'      // main → replay renderer: number (flush id) — rotate now
replaySegment: 'replay:segment'  // replay renderer → main: (data: ArrayBuffer, durationMs: number, ext: RecordFormat, flushId?: number)
replayError: 'replay:error'      // replay renderer → main: string
export interface ReplayJob {
  displaySize: { width: number; height: number }
  resolution: RecordResolution
  fps: RecordFps
  mic: boolean
  systemAudio: boolean
  segmentSec: number
}
export interface ReplayApi {
  onStart: (cb: (job: ReplayJob) => void) => () => void
  onStop: (cb: () => void) => () => void
  onFlush: (cb: (id: number) => void) => () => void
  sendSegment: (data: ArrayBuffer, durationMs: number, ext: RecordFormat, flushId?: number) => void
  sendError: (message: string) => void
}
```

- [ ] **Step 1: Failing prefs tests** — append to `src/shared/prefs.test.ts`:

```ts
describe('replay prefs', () => {
  it('default off, ⌘⇧8, default clips dir, silent save', () => {
    expect(DEFAULT_PREFS.replayBuffer).toBe(0)
    expect(DEFAULT_PREFS.replayShortcut).toBe('CommandOrControl+Shift+8')
    expect(DEFAULT_PREFS.clipsDir).toBeNull()
    expect(DEFAULT_PREFS.clipOpenInEditor).toBe(false)
  })
  it('clamps an unknown replay length to off', () => {
    expect(normalizePrefs({ ...DEFAULT_PREFS, replayBuffer: 45 as never }).replayBuffer).toBe(0)
    expect(normalizePrefs({ ...DEFAULT_PREFS, replayBuffer: 120 }).replayBuffer).toBe(120)
  })
})
```
Run → FAIL.

- [ ] **Step 2: Prefs** — in `src/shared/prefs.ts` add `import { REPLAY_SECONDS, type ReplaySeconds } from './replayPlan'`, the four fields with doc comments (`/** Seconds kept by the background replay buffer; 0 = off. */`, `/** Electron accelerator that saves the replay. */`, `/** Folder for saved clips. null = <Videos>/Snapkit Clips. */`, `/** Open every saved clip in the editor instead of just notifying. */`), defaults `replayBuffer: 0, replayShortcut: 'CommandOrControl+Shift+8', clipsDir: null, clipOpenInEditor: false`, and in `normalizePrefs`: `if (!REPLAY_SECONDS.includes(p.replayBuffer)) p.replayBuffer = 0`. Run → tests pass.

- [ ] **Step 3: IPC + preload + env** — add the channels/types/`ReplayApi` above to `src/shared/ipc.ts`; in `src/preload/index.ts`:

```ts
const replayApi: ReplayApi = {
  onStart: (cb) => on<ReplayJob>(IpcChannels.replayStart, cb),
  onStop: (cb) => on<void>(IpcChannels.replayStop, () => cb()),
  onFlush: (cb) => on<number>(IpcChannels.replayFlush, cb),
  sendSegment: (data, durationMs, ext, flushId) =>
    ipcRenderer.send(IpcChannels.replaySegment, data, durationMs, ext, flushId),
  sendError: (message) => ipcRenderer.send(IpcChannels.replayError, message)
}
```
Expose as `replayApi` in both branches; `env.d.ts` gets `replayApi: ReplayApi`.

- [ ] **Step 4: Shortcut field** — `src/main/prefs.ts` `SHORTCUT_FIELDS`: add `'replayShortcut'` after `'recordWindowShortcut'`. `src/main/index.ts` handlers: add `replayShortcut: () => undefined, // Task 4 wires saveReplay()` so the record compiles.

- [ ] **Step 5: Verify, commit**

`npm run typecheck && npm run lint && npm test` green.
```bash
git add src/shared/prefs.ts src/shared/prefs.test.ts src/shared/ipc.ts src/main/prefs.ts src/main/index.ts src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat(prefs): replay buffer prefs, IPC contract and preload bridge

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Shared capture setup + replay renderer

**Files:**
- Create: `src/renderer/src/recorder/capture.ts`
- Modify: `src/renderer/src/recorder/main.ts` (use `setupCapture`)
- Create: `src/renderer/replay.html`, `src/renderer/src/replay/main.ts`
- Modify: `electron.vite.config.ts` (`replay` input)

**Interfaces (produces):**
```ts
// src/renderer/src/recorder/capture.ts
export interface CaptureOptions {
  source: RecordSource
  rect?: Rect
  displaySize: { width: number; height: number }
  resolution: RecordResolution
  fps: RecordFps
  mic: boolean
  systemAudio: boolean
  format: RecordFormat
  /** The screen track ended (window closed, share stopped). */
  onEnded: () => void
}
export interface Capture {
  stream: MediaStream
  mimeType: string
  ext: RecordFormat
  videoBitsPerSecond: number
  release: () => Promise<void>
}
export async function setupCapture(o: CaptureOptions): Promise<Capture>
```

- [ ] **Step 1: Extract `setupCapture`** — move from `recorder/main.ts` into `capture.ts`: `RAW_STEREO`, `MIC_VOICE`, `MIX_GAIN`, `cropToCanvas`, `mergeAudio`, and the setup part of `record()` (getDisplayMedia → mic → ended listener → optional canvas crop → audio merge → `pickMimeType` → bitrate). `release()` does what the old `finally` did (stop canvas, stop tracks, close the AudioContext). `record()` in `main.ts` becomes:

```ts
async function record(job: RecordJob): Promise<void> {
  const cap = await setupCapture({
    ...job,
    onEnded: () => {
      stopRequested = true
      stopFn?.()
    }
  })
  try {
    const recorder = new MediaRecorder(cap.stream, {
      mimeType: cap.mimeType,
      videoBitsPerSecond: cap.videoBitsPerSecond,
      audioBitsPerSecond: 128_000
    })
    // … chunks / onstop / onerror / start(1000) / await stop / state guard — unchanged …
    const blob = new Blob(chunks, { type: cap.mimeType })
    window.recorderApi.sendResult(await blob.arrayBuffer(), cap.ext)
  } finally {
    await cap.release()
  }
}
```
Behaviour must be identical; `npm run typecheck && npm run lint` green before continuing.

- [ ] **Step 2: Replay renderer**

`src/renderer/replay.html` — same shape as `recorder.html`, title "Snapkit — Replay", script `./src/replay/main.ts`. `electron.vite.config.ts`: `replay: resolve(__dirname, 'src/renderer/replay.html')`.

```ts
// src/renderer/src/replay/main.ts
import type { ReplayJob } from '@shared/ipc'
import { setupCapture, type Capture } from '../recorder/capture'

/**
 * Hidden replay-buffer page. One display stream, a MediaRecorder per 10 s
 * segment; the NEXT recorder starts before the current one stops so no frame
 * is lost at the boundary. Every finished segment is shipped to main, which
 * keeps the ring on disk. A "flush" rotates immediately so the clip can
 * include the seconds recorded since the last boundary.
 */

let stopRequested = false
let rotate: ((flushId?: number) => void) | null = null

window.replayApi.onStop(() => {
  stopRequested = true
  rotate?.()
})
window.replayApi.onFlush((id) => rotate?.(id))
window.replayApi.onStart((job) => {
  void run(job).catch((err: unknown) => {
    console.error('[replay]', err)
    window.replayApi.sendError(err instanceof Error ? err.message : String(err))
  })
})

interface Running {
  finish: () => Promise<{ buffer: ArrayBuffer; durationMs: number }>
}

function startSegment(cap: Capture): Running {
  const rec = new MediaRecorder(cap.stream, {
    mimeType: cap.mimeType,
    videoBitsPerSecond: cap.videoBitsPerSecond,
    audioBitsPerSecond: 128_000
  })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  const stopped = new Promise<void>((resolve) => {
    rec.onstop = () => resolve()
    rec.onerror = (e) => {
      console.error('[replay] MediaRecorder error', e)
      resolve()
    }
  })
  const startedAt = performance.now()
  rec.start()
  return {
    finish: async () => {
      if (rec.state !== 'inactive') rec.stop()
      await stopped
      const blob = new Blob(chunks, { type: cap.mimeType })
      return { buffer: await blob.arrayBuffer(), durationMs: Math.round(performance.now() - startedAt) }
    }
  }
}

/** Resolves after ms, or earlier when rotate() is called (with an optional flush id). */
function waitRotate(ms: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms)
    rotate = (flushId) => {
      clearTimeout(timer)
      rotate = null
      resolve(flushId)
    }
  })
}

async function run(job: ReplayJob): Promise<void> {
  const cap = await setupCapture({
    source: 'screen',
    displaySize: job.displaySize,
    resolution: job.resolution,
    fps: job.fps,
    mic: job.mic,
    systemAudio: job.systemAudio,
    format: 'mp4',
    onEnded: () => {
      // Display unplugged / capture revoked: main restarts the buffer on this error.
      stopRequested = true
      rotate?.()
      window.replayApi.sendError('screen capture ended')
    }
  })
  try {
    let current = startSegment(cap)
    while (true) {
      const flushId = await waitRotate(job.segmentSec * 1000)
      const next = stopRequested ? null : startSegment(cap)
      const seg = await current.finish()
      if (seg.buffer.byteLength > 0) {
        window.replayApi.sendSegment(seg.buffer, seg.durationMs, cap.ext, flushId)
      } else if (flushId !== undefined) {
        // A flush must always be answered, or main waits for its timeout.
        window.replayApi.sendSegment(new ArrayBuffer(0), 0, cap.ext, flushId)
      }
      if (!next) break
      current = next
    }
  } finally {
    await cap.release()
  }
}
```

- [ ] **Step 3: Verify, commit**

`npm run typecheck && npm run lint && npm test` green. Manual (recorder unchanged in behaviour): `npm run dev -- -- --user-data-dir=/tmp/snapkit-dev` → Record Area 5 s → editor opens, file plays with audio as before.

```bash
git add src/renderer/src/recorder/capture.ts src/renderer/src/recorder/main.ts src/renderer/replay.html src/renderer/src/replay/main.ts electron.vite.config.ts
git commit -m "feat(replay): shared capture setup and the segment-rotating replay renderer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `src/main/replay.ts` — buffer lifecycle, ring, clip save

**Files:**
- Create: `src/main/replay.ts`
- Modify: `src/main/recorder.ts` (one-shot `setPendingSource`, recording-state exports)
- Modify: `src/main/index.ts` (wire `initReplay`, `applyReplayPrefs`, `saveReplay` handler)

**Interfaces (produces):**
```ts
// recorder.ts
export interface PendingSource { displayId: number; sourceId?: string; audio: boolean }
export function setPendingSource(s: PendingSource): void      // consumed by the next getDisplayMedia request
export function isRecording(): boolean
export function stopCurrentRecording(): void
export function onRecordingStateChange(cb: (recording: boolean) => void): void
// replay.ts
export function initReplay(): void                              // IPC + power/display listeners
export function applyReplayPrefs(prefs: Prefs): void            // start / stop / resize the ring
export function saveReplay(): void                              // the hotkey
export function isReplayRunning(): boolean
export function onReplayStateChange(cb: (running: boolean) => void): void
```

- [ ] **Step 1: recorder.ts — one-shot routing + state**

Replace the `pendingSource` handling:

```ts
export interface PendingSource {
  displayId: number
  sourceId?: string
  audio: boolean
}
let pendingSource: PendingSource | null = null

/** Route the NEXT getDisplayMedia() request (recorder or replay window) to this source. */
export function setPendingSource(s: PendingSource): void {
  pendingSource = s
}
```
In `setupDisplayMediaHandler`: after reading `const pending = pendingSource`, set `pendingSource = null` (one-shot) before the `if (!pending)` check. In `begin()`: `setPendingSource({ displayId: display.id, sourceId: …, audio: systemAudio })`. In `teardown()`: delete the `pendingSource = null` line (a concurrent replay start may own it).

State exports:
```ts
const stateListeners = new Set<(recording: boolean) => void>()
export function onRecordingStateChange(cb: (recording: boolean) => void): void {
  stateListeners.add(cb)
}
const emitState = (): void => stateListeners.forEach((cb) => cb(current !== null))
export function isRecording(): boolean {
  return current !== null
}
export function stopCurrentRecording(): void {
  stopRecording()
}
```
Call `emitState()` right after `current = { … }` in `begin()` and at the end of `teardown()`.

- [ ] **Step 2: `src/main/replay.ts`**

```ts
// src/main/replay.ts
import { app, BrowserWindow, ipcMain, Notification, powerMonitor, screen, shell } from 'electron'
import { mkdir, readdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { IpcChannels, type ReplayJob } from '@shared/ipc'
import type { Prefs } from '@shared/prefs'
import type { RecordFormat } from '@shared/recordPlan'
import { clipFileName, clipStartSec, concatListText, ringTrim, SEGMENT_SEC, type Segment } from '@shared/replayPlan'
import { concatArgs } from '@shared/videoArgs'
import { runFfmpeg } from './ffmpeg'
import { flashRegion } from './flash'
import { getPrefs } from './prefs'
import { APP_URL } from './protocol'
import { setPendingSource, systemAudioSupported } from './recorder'
import { openVideo } from './video'

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']
const FLUSH_TIMEOUT_MS = 5_000
const RESTART_DELAY_MS = 1_500

interface Buffer_ {
  win: BrowserWindow
  dir: string
  segments: Segment[]
  keepMs: number
  seq: number
  ext: RecordFormat | null
  stopping: boolean
}

let buffer: Buffer_ | null = null
let saving = false
let flushSeq = 0
let pendingFlush: { id: number; resolve: () => void } | null = null
const listeners = new Set<(running: boolean) => void>()

export function isReplayRunning(): boolean {
  return buffer !== null
}
export function onReplayStateChange(cb: (running: boolean) => void): void {
  listeners.add(cb)
}
const emit = (): void => listeners.forEach((cb) => cb(buffer !== null))

const ringDir = (): string => join(app.getPath('temp'), 'snapkit-replay')
const clipsDir = (prefs: Prefs): string => prefs.clipsDir ?? join(app.getPath('videos'), 'Snapkit Clips')

export function initReplay(): void {
  ipcMain.on(
    IpcChannels.replaySegment,
    (event, data: ArrayBuffer, durationMs: number, ext: RecordFormat, flushId?: number) => {
      if (!buffer || event.sender.id !== buffer.win.webContents.id) return
      void storeSegment(buffer, Buffer.from(data), durationMs, ext).finally(() => {
        if (flushId !== undefined && pendingFlush?.id === flushId) {
          pendingFlush.resolve()
          pendingFlush = null
        }
      })
    }
  )
  ipcMain.on(IpcChannels.replayError, (event, message: string) => {
    if (!buffer || event.sender.id !== buffer.win.webContents.id) return
    console.warn('[replay] renderer error:', message)
    new Notification({ title: 'Replay buffer stopped', body: message }).show()
    restartLater()
  })
  // The stream dies across sleep and display changes; the renderer notices too,
  // but restarting explicitly keeps the buffer alive without waiting for it.
  powerMonitor.on('resume', restartLater)
  screen.on('display-removed', restartLater)
  applyReplayPrefs(getPrefs())
}

/** Start, stop or resize the buffer to match the prefs. Idempotent. */
export function applyReplayPrefs(prefs: Prefs): void {
  const keepMs = prefs.replayBuffer * 1000
  if (keepMs === 0) {
    if (buffer) void stopBuffer()
    return
  }
  if (buffer) {
    buffer.keepMs = keepMs
    void trimRing(buffer)
    return
  }
  void startBuffer(keepMs)
}

async function startBuffer(keepMs: number): Promise<void> {
  if (buffer) return
  const prefs = getPrefs()
  const dir = ringDir()
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  await mkdir(dir, { recursive: true })

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const systemAudio = prefs.recordSystemAudio && systemAudioSupported()
  setPendingSource({ displayId: display.id, audio: systemAudio })

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  const job: ReplayJob = {
    displaySize: { width: display.size.width, height: display.size.height },
    resolution: prefs.recordResolution,
    fps: prefs.recordFps,
    // Mic permission was already prompted by any earlier recording; never prompt from a background buffer.
    mic: prefs.recordMic && process.platform !== 'darwin',
    systemAudio,
    segmentSec: SEGMENT_SEC
  }
  win.webContents.once('did-finish-load', () => win.webContents.send(IpcChannels.replayStart, job))
  void win.loadURL(RENDERER_DEV_URL ? `${RENDERER_DEV_URL}/replay.html` : `${APP_URL}/replay.html`)

  const onDied = (): void => {
    if (buffer?.win === win && !buffer.stopping) {
      buffer = null
      emit()
      restartLater()
    }
  }
  win.on('closed', onDied)
  win.webContents.on('render-process-gone', onDied)

  buffer = { win, dir, segments: [], keepMs, seq: 0, ext: null, stopping: false }
  emit()
}

async function stopBuffer(): Promise<void> {
  const b = buffer
  if (!b) return
  b.stopping = true
  buffer = null
  emit()
  if (!b.win.isDestroyed()) {
    b.win.webContents.send(IpcChannels.replayStop)
    // Give the renderer a moment to release the stream, then drop the window.
    setTimeout(() => {
      if (!b.win.isDestroyed()) b.win.destroy()
    }, 2_000)
  }
  await rm(b.dir, { recursive: true, force: true }).catch(() => undefined)
}

let restartTimer: NodeJS.Timeout | null = null
function restartLater(): void {
  if (restartTimer) return
  restartTimer = setTimeout(() => {
    restartTimer = null
    const prefs = getPrefs()
    if (prefs.replayBuffer === 0) return
    void (buffer ? stopBuffer() : Promise.resolve()).then(() => startBuffer(prefs.replayBuffer * 1000))
  }, RESTART_DELAY_MS)
}

async function storeSegment(b: Buffer_, bytes: Buffer, durationMs: number, ext: RecordFormat): Promise<void> {
  if (bytes.byteLength === 0) return
  b.ext = ext
  const path = join(b.dir, `seg-${String(b.seq++).padStart(6, '0')}.${ext}`)
  try {
    await writeFile(path, bytes)
  } catch (err) {
    // Disk full or temp dir gone: stop rather than loop on failures.
    new Notification({
      title: 'Replay buffer stopped',
      body: err instanceof Error ? err.message : String(err)
    }).show()
    await stopBuffer()
    return
  }
  b.segments.push({ path, durationMs })
  await trimRing(b)
}

async function trimRing(b: Buffer_): Promise<void> {
  const { keep, drop } = ringTrim(b.segments, b.keepMs)
  b.segments = keep
  await Promise.all(drop.map((s) => rm(s.path, { force: true }).catch(() => undefined)))
}

/** Ask the renderer to close the in-progress segment; resolves when it arrived (or on timeout). */
function flush(b: Buffer_): Promise<void> {
  return new Promise((resolve) => {
    const id = ++flushSeq
    const timer = setTimeout(() => {
      if (pendingFlush?.id === id) pendingFlush = null
      resolve()
    }, FLUSH_TIMEOUT_MS)
    pendingFlush = {
      id,
      resolve: () => {
        clearTimeout(timer)
        resolve()
      }
    }
    if (!b.win.isDestroyed()) b.win.webContents.send(IpcChannels.replayFlush, id)
    else resolve()
  })
}

/** The hotkey: flush, concat the ring's tail, save, notify. */
export function saveReplay(): void {
  const b = buffer
  if (!b || saving) return
  saving = true
  void (async () => {
    const prefs = getPrefs()
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    flashRegion(display.bounds)
    new Notification({ title: 'Saving clip…', silent: true }).show()

    await flush(b)
    if (b.segments.length === 0 || !b.ext) {
      new Notification({ title: 'Nothing to save yet', body: 'The replay buffer is still warming up.' }).show()
      return
    }
    const segments = [...b.segments]
    const totalMs = segments.reduce((acc, s) => acc + s.durationMs, 0)
    const list = join(b.dir, `clip-${Date.now()}.txt`)
    const dir = clipsDir(prefs)
    const out = join(dir, clipFileName(new Date(), b.ext))
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(list, concatListText(segments.map((s) => s.path)))
      await runFfmpeg({
        args: concatArgs(list, out, clipStartSec(totalMs, b.keepMs)),
        durationSec: Math.min(totalMs, b.keepMs) / 1000
      })
      const done = new Notification({ title: 'Clip saved', body: out, silent: true })
      done.on('click', () => shell.showItemInFolder(out))
      done.show()
      if (prefs.clipOpenInEditor) openVideo(out)
    } catch (err) {
      new Notification({
        title: 'Could not save clip',
        body: err instanceof Error ? err.message : String(err)
      }).show()
    } finally {
      await rm(list, { force: true }).catch(() => undefined)
    }
  })().finally(() => {
    saving = false
  })
}

/** Leftovers from a crashed previous run. Call once at startup before the buffer starts. */
export async function sweepReplayTemp(): Promise<void> {
  const dir = ringDir()
  const names = await readdir(dir).catch(() => [] as string[])
  await Promise.all(names.map((n) => rm(join(dir, n), { force: true }).catch(() => undefined)))
}
```
Note on the mic: `getUserMedia` from a background window on macOS would pop the permission prompt at login; the buffer therefore mixes the mic only where no prompt exists (Windows/Linux) and otherwise records system audio only — say so in the prefs hint (Task 6).

- [ ] **Step 3: Wiring** — `src/main/index.ts`: import `{ applyReplayPrefs, initReplay, saveReplay, sweepReplayTemp }`; call `void sweepReplayTemp().then(() => initReplay())` after `initVideo()`; handler `replayShortcut: () => saveReplay()`; in `registerPrefsIpc`'s `onSaved` add `applyReplayPrefs(updated)`. Record shortcuts toggle stop: wrap the three record handlers —

```ts
    const recordOrStop = (mode: CaptureMode) => (): void => {
      if (isRecording()) stopCurrentRecording()
      else startCapture(mode, host)
    }
    …
      recordShortcut: recordOrStop('record'),
      recordScreenShortcut: recordOrStop('record-screen'),
      recordWindowShortcut: recordOrStop('record-window'),
```
(import `CaptureMode` type from `@shared/ipc`, `isRecording`/`stopCurrentRecording` from `./recorder`).

- [ ] **Step 4: Verify, smoke, commit**

`npm run typecheck && npm run lint && npm test` green. Manual (prefs UI comes in Task 6 — set the pref from the home window devtools: `window.api.setPrefs({ replayBuffer: 30 })`): a hidden window starts; after ~35 s the ring in the OS temp dir — `ls "$(node -e "console.log(require('os').tmpdir())")/snapkit-replay"` — shows 4 segment files rolling. Press ⌘⇧8 → flash, "Saving clip…", then "Clip saved" within ~2 s; the clip in `~/Movies/Snapkit Clips` is ~30 s and plays in QuickTime (check the segment boundaries for glitches). Press again 3 s later → a second clip. `window.api.setPrefs({ replayBuffer: 0 })` → window gone, temp dir empty. Start a manual Record Area while the buffer runs → both work; press ⌘⇧7 again → recording stops (toggle).

```bash
git add src/main/replay.ts src/main/recorder.ts src/main/index.ts
git commit -m "feat(replay): background buffer with disk ring, flush-on-hotkey clip save, self-restart; record shortcuts toggle stop

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Tray — state icon, "Save Replay (N s)", "Stop Recording"

**Files:**
- Modify: `scripts/make-tray-icon.mjs` (second variant), regenerate `resources/tray-icon-rec.png` + `@2x`
- Modify: `src/main/tray.ts`, `src/main/index.ts`

- [ ] **Step 1: Icon variant** — `scripts/make-tray-icon.mjs` today renders a black alpha mask (`render(size)`) and encodes it to PNG for `tray-iconTemplate.png` / `@2x`. Add a second, NON-template pair `tray-icon-rec.png` / `tray-icon-rec@2x.png`: the same glyph in mid grey (visible on light and dark menu bars) plus a red dot at the bottom-right. Add after `render`:

```js
/** Recording variant: grey glyph + red dot, full-colour (macOS must NOT treat it as a template). */
function renderRec(size) {
  const px = render(size) // alpha mask in channel 3, RGB 0
  for (let i = 0; i < size * size; i++) {
    if (px[i * 4 + 3] > 0) {
      px[i * 4] = 0x8e
      px[i * 4 + 1] = 0x8e
      px[i * 4 + 2] = 0x93
    }
  }
  // Red dot, supersampled, alpha-blended over whatever is there.
  const SS = 8
  const cx = 0.8
  const cy = 0.8
  const R = 0.17
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size
          const v = (y + (sy + 0.5) / SS) / size
          if (Math.hypot(u - cx, v - cy) <= R) acc++
        }
      }
      const a = acc / (SS * SS)
      if (a === 0) continue
      const o = (y * size + x) * 4
      const prevA = px[o + 3] / 255
      const outA = a + prevA * (1 - a)
      const mix = (c, prev) => Math.round((c * a + prev * prevA * (1 - a)) / (outA || 1))
      px[o] = mix(0xff, px[o])
      px[o + 1] = mix(0x3b, px[o + 1])
      px[o + 2] = mix(0x30, px[o + 2])
      px[o + 3] = Math.round(outA * 255)
    }
  }
  return px
}
```
and, next to the existing two `writeFileSync(...encodePng(render(16|32)))` calls, write `tray-icon-rec.png` (16, `renderRec(16)`) and `tray-icon-rec@2x.png` (32, `renderRec(32)`) with the same PNG encoder. Run `npm run gen:icon`; `ls resources/` shows four PNGs; open `resources/tray-icon-rec@2x.png` (Quick Look) — grey glyph, red dot bottom-right. Commit the PNGs.

- [ ] **Step 2: tray.ts**

```ts
import trayIconRecPath from '../../resources/tray-icon-rec.png?asset'

export interface TrayActions {
  show: () => void
  captureArea: () => void
  captureFullscreen: () => void
  captureWindow: () => void
  captureScrolling: () => void
  recordArea: () => void
  recordScreen: () => void
  recordWindow: () => void
  stopRecording: () => void
  saveReplay: () => void
  editVideo: () => void
  clipboardHistory: () => void
  quit: () => void
}
export interface TrayState {
  recording: boolean
  replayRunning: boolean
}
type TrayPrefs = Pick<
  Prefs,
  | 'captureShortcut'
  | 'fullscreenShortcut'
  | 'windowShortcut'
  | 'scrollingShortcut'
  | 'recordShortcut'
  | 'recordScreenShortcut'
  | 'recordWindowShortcut'
  | 'replayShortcut'
  | 'replayBuffer'
  | 'historyShortcut'
>

let prefsRef: TrayPrefs | null = null
let stateRef: TrayState = { recording: false, replayRunning: false }
```
Menu additions (after "Record Window…"):
```ts
    { label: 'Stop Recording', enabled: state.recording, click: actions.stopRecording },
    {
      label: prefs.replayBuffer > 0 ? `Save Replay (${prefs.replayBuffer} s)` : 'Save Replay (buffer off)',
      accelerator: prefs.replayShortcut,
      enabled: state.replayRunning,
      click: actions.saveReplay
    },
```
`buildMenu(prefs, state)`; `createTray(actions, prefs)` stores `prefsRef`; `updateTrayShortcuts(prefs)` stores and rebuilds; new `export function updateTrayState(patch: Partial<TrayState>): void` merges, rebuilds the menu and swaps the image: `tray.setImage(icon(state.recording || state.replayRunning))` where the rec icon is loaded once via `nativeImage.createFromPath(trayIconRecPath)` (no `setTemplateImage`).

- [ ] **Step 3: Wire** — `index.ts`: tray actions `saveReplay: () => saveReplay()`, `stopRecording: () => stopCurrentRecording()`; after `createTray`: `onRecordingStateChange((recording) => updateTrayState({ recording }))` and `onReplayStateChange((replayRunning) => updateTrayState({ replayRunning }))`.

- [ ] **Step 4: Verify, smoke, commit**

`npm run typecheck && npm run lint && npm test` green. Manual: buffer on → tray icon shows the red dot, "Save Replay (30 s)" enabled; buffer off → normal icon, item disabled; during a recording → red dot + "Stop Recording" enabled, clicking it stops and opens the editor.

```bash
git add scripts/make-tray-icon.mjs resources/tray-icon-rec.png resources/tray-icon-rec@2x.png src/main/tray.ts src/main/index.ts
git commit -m "feat(tray): recording/replay state icon, Save Replay and Stop Recording entries

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Preferences UI, docs, smoke sign-off

**Files:**
- Modify: `src/renderer/src/PrefsPanel.tsx`
- Modify: `README.md`, `ROADMAP.md`, spec §3 V2

- [ ] **Step 1: Prefs rows** — after the recording rows:

```tsx
          <Row label="Replay buffer">
            <Segmented
              ariaLabel="Replay buffer length"
              value={prefs.replayBuffer}
              options={[
                { value: 0, label: 'Off' },
                { value: 30, label: '30 s' },
                { value: 60, label: '1 m' },
                { value: 120, label: '2 m' },
                { value: 300, label: '5 m' }
              ]}
              onChange={(replayBuffer) => patch({ replayBuffer })}
            />
          </Row>
          {prefs.replayBuffer > 0 && (
            <p className="pb-3 text-xs text-muted-foreground">
              Records the screen under the cursor continuously. Uses up to ≈{Math.round((prefs.replayBuffer + 10) * 2.5)} MB of
              temporary disk at 1080p60. System audio only on macOS (the microphone would prompt at login).
            </p>
          )}
          <Row label="Save replay">
            <ShortcutRecorder
              label="Save replay shortcut"
              value={prefs.replayShortcut}
              onRecord={(acc) => patch({ replayShortcut: acc })}
            />
          </Row>
          <Row label="Clips folder">
            <span className="max-w-44 truncate text-xs text-muted-foreground" title={prefs.clipsDir ?? 'Movies/Snapkit Clips'}>
              {prefs.clipsDir ?? 'Movies/Snapkit Clips'}
            </span>
            <Button variant="outline" size="sm" onClick={() => void window.api.pickExportDir().then((dir) => dir && patch({ clipsDir: dir }))}>
              <Folder />
              Choose…
            </Button>
          </Row>
          <Row label="Open clips in the editor">
            <Toggle ariaLabel="Open clips in the editor" checked={prefs.clipOpenInEditor} onChange={(clipOpenInEditor) => patch({ clipOpenInEditor })} />
          </Row>
```
(`pickExportDir` is a generic directory picker; reuse it.)

- [ ] **Step 2: Docs** — README Features: **Replay** block ("Keep the last 30 s – 5 min of your screen in a background buffer; ⌘⇧8 saves it as a clip in ~2 s — for games, demos, bugs you only notice after they happen."), shortcut list ⌘⇧8, clips folder default, disk usage note, macOS mic note. ROADMAP 3.1 → `V2 replay ✅ — video suite complete`; remove the "stop entry point" debt bullet (landed), add "Replay: follow the cursor across displays; per-app audio; game detection". Spec §3 V2 "Landed" note: flush-on-hotkey, duration-based ring, overlapping recorders (no boundary frame loss), mic-off on macOS for the buffer, one-shot display-media routing.

- [ ] **Step 3: Smoke checklist** (do it; tick in the commit body):
  1. Prefs: set 60 s → tray dot appears within 2 s; segments roll in the temp dir (7 files max).
  2. Play music, ⌘⇧8 → flash + notifications; clip ≈ 60 s, audio continuous across boundaries (listen at 10/20/30 s), no visual hiccup.
  3. ⌘⇧8 twice within 3 s → two clips, no error.
  4. ⌘⇧8 with a 3 s old buffer → clip of ~3 s (no error).
  5. Sleep the Mac 30 s, wake → buffer restarts (tray dot back, new segments).
  6. Set Off → window gone (Activity Monitor), temp dir empty; Save Replay item disabled.
  7. Buffer on + Record Screen simultaneously → both work; ⌘⇧9 again → recording stops and the editor opens.
  8. Open clips in editor → the clip opens in the editor after saving.
  9. Fill the clips folder path with a read-only dir → "Could not save clip" notification, buffer keeps running.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/PrefsPanel.tsx README.md ROADMAP.md docs/superpowers/specs/2026-09-03-video-suite-design.md
git commit -m "feat(prefs): replay buffer settings; docs for the replay feature

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
