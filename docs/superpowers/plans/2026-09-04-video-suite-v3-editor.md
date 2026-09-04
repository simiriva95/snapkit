# Video Suite V3 — Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A video window that opens every finished recording (and any dropped/picked video) and exports it trimmed, resized, compressed, converted (mp4 / webm / gif) or muted through the bundled ffmpeg.

**Architecture:** Main owns files and ffmpeg: it streams the source to the renderer over the existing `app://` scheme with HTTP Range support, keeps an allow-list of openable paths, turns `ExportEdits` into an ffmpeg command via pure planners (`src/shared/videoPlan.ts` → V0's `videoArgs.ts` builders) and relays progress. The renderer (`video.html`, React + zustand) is a player with an in/out timeline and an export panel; it never touches the filesystem. Finished recordings are remuxed into `userData/recordings/` and handed to the editor instead of a save dialog.

**Tech Stack:** Electron 43, electron-vite 5, React 19, Tailwind v4, zustand, vitest 4, bundled ffmpeg 9.0.1 via `src/main/ffmpeg.ts` (`runFfmpeg`, `ffmpegPath`) and `src/shared/videoArgs.ts` (`trimArgs`, `transcodeArgs`, `gifArgs`, `videoKbpsForTarget`). No new dependencies.

Spec: `docs/superpowers/specs/2026-09-03-video-suite-design.md` §3 V3, §5 error table.

Branch: `claude/snapkit-video-suite-v3` from the V1 branch head (`claude/snapkit-video-suite-v1`, PR #11). Stacked.

## Global Constraints

- No new npm dependencies. `konva` is NOT used for the timeline (plain DOM + canvas).
- The renderer never receives a filesystem path it can read directly; video bytes flow only through `app://bundle/video?path=<encoded>` and only for paths main allow-listed via `openVideo()`. Anything else → 403.
- Export path selection (verbatim from spec): `if only trim changed and container unchanged → trimArgs (stream copy, instant) · else if gif → gifArgs · else → transcodeArgs`. "Only trim changed" = compression mode **Original**, resolution Native, mute off.
- Export filename default `<original> (edited).<ext>` in `prefs.exportDir` (fallback Desktop); save dialog first, then ffmpeg with progress; `shell.showItemInFolder` on success; partial output is removed by `runFfmpeg` (already true).
- Export panel options: Format mp4 · webm · gif; Resolution Native · 1080p · 720p · 480p (options ≥ source height hidden); Compression Original / High / Medium / Low / Target size (MB); GIF shows fps 10/15/20 and max width instead of compression/mute; Mute toggle hidden for gif; live size estimate; Export + progress + Cancel.
- Keyboard in the editor: `I` / `O` set in/out at the playhead, `[` / `]` nudge the nearer handle by one frame (1/30 s — source fps is unknown to the renderer), `Space` play/pause.
- Errors (spec §5): ffmpeg missing → Export disabled + hint; ffmpeg exit ≠ 0 → error text from the wrapper shown in the panel; source file gone → "File moved or deleted", Export disabled.
- Finished recordings: remuxed (`-c copy`, `+faststart` for mp4) into `app.getPath('userData')/recordings/`, opened in the editor; files older than 7 days are pruned at startup.
- `npm test`, `npm run typecheck`, `npm run lint` green before every commit. Manual smoke runs `npm run dev -- -- --user-data-dir=/tmp/snapkit-dev`.

## File structure

| File | Responsibility |
|---|---|
| `src/shared/videoPlan.ts` (+test) | Pure: `ExportEdits`, `VideoMeta`, `isTrimmed`, `canCopy`, `normalizeEdits`, `planExport`, `estimateBytes`, `defaultEdits` |
| `src/shared/ipc.ts` | `VideoOpenPayload`, `VideoExportRequest/Result`, `VideoApi`, channels |
| `src/main/videoServe.ts` (+test) | `parseRange` (pure), `allowVideoPath`, `serveVideo(request)` with Range |
| `src/main/protocol.ts` | Register the handler in dev too; route `/video` |
| `src/main/video.ts` (+test for `staleRecordings`) | Editor window, `openVideo`, export IPC + progress + cancel, file picker, `finalizeRecording`, `pruneRecordings` |
| `src/main/recorder.ts` | `saveRecording` → `finalizeRecording` (editor handoff) |
| `src/main/index.ts`, `src/main/tray.ts` | wire `initVideo`, tray "Edit Video…" |
| `src/preload/index.ts`, `src/renderer/src/env.d.ts` | `videoApi` |
| `electron.vite.config.ts` | `video` renderer input |
| `src/renderer/video.html`, `src/renderer/src/video/{main.tsx,store.ts,VideoEditor.tsx,Player.tsx,Timeline.tsx,ExportPanel.tsx,filmstrip.ts,format.ts}` | The editor |
| `src/renderer/src/components/ui/{segmented,toggle}.tsx` | `Segmented`/`Toggle` moved out of `PrefsPanel.tsx` so the editor reuses them |
| `README.md`, `ROADMAP.md`, spec | Docs |

---

### Task 1: `src/shared/videoPlan.ts` — export model and pure planners

**Files:**
- Create: `src/shared/videoPlan.ts`
- Create: `src/shared/videoPlan.test.ts`

**Interfaces:**
- Consumes: `trimArgs`, `transcodeArgs`, `gifArgs`, `videoKbpsForTarget`, `Quality`, `Container` from `src/shared/videoArgs.ts` (V0).
- Produces:
  ```ts
  export type ExportContainer = 'mp4' | 'webm' | 'gif'
  export type ExportHeight = 'native' | 1080 | 720 | 480
  export type GifFps = 10 | 15 | 20
  export type CompressionMode =
    | { kind: 'copy' }
    | { kind: 'quality'; quality: Quality }
    | { kind: 'size'; targetMB: number }
  export interface ExportEdits {
    inSec: number
    outSec: number
    container: ExportContainer
    height: ExportHeight
    mode: CompressionMode
    mute: boolean
    gifFps: GifFps
    gifMaxWidth: number
  }
  export interface VideoMeta {
    durationSec: number
    width: number
    height: number
    /** Source container from the file extension; anything else is 'other'. */
    container: 'mp4' | 'webm' | 'other'
    sizeBytes: number
  }
  export function defaultEdits(meta: VideoMeta): ExportEdits
  export function isTrimmed(e: ExportEdits, meta: VideoMeta): boolean
  export function canCopy(e: ExportEdits, meta: VideoMeta): boolean
  export function normalizeEdits(e: ExportEdits, meta: VideoMeta): ExportEdits
  export function planExport(e: ExportEdits, meta: VideoMeta, input: string, output: string): { kind: 'copy' | 'gif' | 'transcode'; args: string[] }
  export function estimateBytes(e: ExportEdits, meta: VideoMeta): number
  ```

- [ ] **Step 1: Failing tests**

```ts
// src/shared/videoPlan.test.ts
import { describe, expect, it } from 'vitest'
import {
  canCopy,
  defaultEdits,
  estimateBytes,
  isTrimmed,
  normalizeEdits,
  planExport,
  type ExportEdits,
  type VideoMeta
} from './videoPlan'

const meta: VideoMeta = { durationSec: 60, width: 1920, height: 1080, container: 'mp4', sizeBytes: 60_000_000 }
const base: ExportEdits = defaultEdits(meta)

describe('defaultEdits', () => {
  it('starts as a full-length, same-container, original-quality export', () => {
    expect(base).toEqual({
      inSec: 0, outSec: 60, container: 'mp4', height: 'native', mode: { kind: 'copy' },
      mute: false, gifFps: 15, gifMaxWidth: 640
    })
  })
  it('a non mp4/webm source defaults to mp4 medium (copy is impossible)', () => {
    const e = defaultEdits({ ...meta, container: 'other' })
    expect(e.container).toBe('mp4')
    expect(e.mode).toEqual({ kind: 'quality', quality: 'medium' })
  })
})

describe('isTrimmed / canCopy', () => {
  it('a range within 10 ms of the full length is not a trim', () => {
    expect(isTrimmed({ ...base, inSec: 0.005, outSec: 59.995 }, meta)).toBe(false)
    expect(isTrimmed({ ...base, inSec: 1 }, meta)).toBe(true)
    expect(isTrimmed({ ...base, outSec: 30 }, meta)).toBe(true)
  })
  it('copy needs same container, native height and audio kept', () => {
    expect(canCopy(base, meta)).toBe(true)
    expect(canCopy({ ...base, container: 'webm' }, meta)).toBe(false)
    expect(canCopy({ ...base, height: 720 }, meta)).toBe(false)
    expect(canCopy({ ...base, mute: true }, meta)).toBe(false)
    expect(canCopy({ ...base, container: 'gif' }, meta)).toBe(false)
  })
})

describe('normalizeEdits', () => {
  it('drops copy mode when copy is no longer possible', () => {
    expect(normalizeEdits({ ...base, height: 720 }, meta).mode).toEqual({ kind: 'quality', quality: 'medium' })
  })
  it('hides heights that are not smaller than the source', () => {
    expect(normalizeEdits({ ...base, height: 1080 }, meta).height).toBe('native')
    expect(normalizeEdits({ ...base, height: 720, mode: { kind: 'quality', quality: 'low' } }, meta).height).toBe(720)
  })
  it('clamps and orders the trim range, keeping at least one frame', () => {
    const e = normalizeEdits({ ...base, inSec: -5, outSec: 999 }, meta)
    expect(e.inSec).toBe(0)
    expect(e.outSec).toBe(60)
    const f = normalizeEdits({ ...base, inSec: 30, outSec: 30 }, meta)
    expect(f.outSec - f.inSec).toBeCloseTo(1 / 30)
  })
  it('gif ignores mute and copy', () => {
    const e = normalizeEdits({ ...base, container: 'gif', mute: true }, meta)
    expect(e.mute).toBe(false)
    expect(e.mode.kind).toBe('quality')
  })
})

describe('planExport', () => {
  it('copy: trim-only export is a stream copy', () => {
    const p = planExport({ ...base, inSec: 2, outSec: 10 }, meta, 'in.mp4', 'out.mp4')
    expect(p.kind).toBe('copy')
    expect(p.args).toEqual(['-ss', '2', '-to', '10', '-i', 'in.mp4', '-c', 'copy', '-avoid_negative_ts', 'make_zero', 'out.mp4'])
  })
  it('copy without a trim still remuxes the whole file', () => {
    expect(planExport(base, meta, 'in.mp4', 'out.mp4').args).toEqual(['-i', 'in.mp4', '-c', 'copy', '-avoid_negative_ts', 'make_zero', 'out.mp4'])
  })
  it('gif: fps and width capped at the source width', () => {
    const p = planExport({ ...base, container: 'gif', gifFps: 10, gifMaxWidth: 4000, inSec: 1, outSec: 4 }, meta, 'in.mp4', 'out.gif')
    expect(p.kind).toBe('gif')
    expect(p.args[3]).toBe('in.mp4')
    expect(p.args[5]).toContain('fps=10,scale=1920:-1:flags=lanczos')
    expect(p.args.at(-1)).toBe('out.gif')
  })
  it('transcode: quality mode, scaled, muted, trimmed', () => {
    const p = planExport(
      { ...base, container: 'webm', height: 720, mode: { kind: 'quality', quality: 'high' }, mute: true, inSec: 5, outSec: 15 },
      meta, 'in.mp4', 'out.webm'
    )
    expect(p.kind).toBe('transcode')
    expect(p.args).toEqual([
      '-ss', '5', '-to', '15', '-i', 'in.mp4', '-vf', 'scale=-2:720',
      '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-an', 'out.webm'
    ])
  })
  it('transcode: target size passes the source duration so the trimmed length is used', () => {
    const p = planExport({ ...base, mode: { kind: 'size', targetMB: 5 }, inSec: 10, outSec: 20 }, meta, 'in.mp4', 'out.mp4')
    // 5 MB over 10 s = 4000 kbps − 128 audio = 3872
    expect(p.args).toContain('3872k')
  })
})

describe('estimateBytes', () => {
  it('copy: proportional share of the source size', () => {
    expect(estimateBytes({ ...base, inSec: 0, outSec: 30 }, meta)).toBe(30_000_000)
  })
  it('size mode: the target itself', () => {
    expect(estimateBytes({ ...base, mode: { kind: 'size', targetMB: 5 } }, meta)).toBe(5_000_000)
  })
  it('quality mode: bits per pixel × frames + audio', () => {
    // 1920×1080 × 30 fps × 0.08 bpp × 60 s / 8 + 128 kbps × 60 s / 8
    const e = { ...base, mode: { kind: 'quality', quality: 'medium' } as const }
    expect(estimateBytes(e, meta)).toBe(Math.round((1920 * 1080 * 30 * 0.08 * 60) / 8 + (128_000 * 60) / 8))
  })
  it('gif: ~0.12 bytes per pixel per frame', () => {
    const e = { ...base, container: 'gif' as const, gifFps: 10 as const, gifMaxWidth: 640, inSec: 0, outSec: 10 }
    expect(estimateBytes(e, meta)).toBe(Math.round(640 * 360 * 10 * 10 * 0.12))
  })
})
```

- [ ] **Step 2: Run** `npx vitest run src/shared/videoPlan.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/shared/videoPlan.ts
/**
 * Export model for the video editor and the pure planners that turn it into
 * an ffmpeg command (via videoArgs builders) or a size estimate. No I/O.
 */
import { gifArgs, transcodeArgs, trimArgs, type Quality } from './videoArgs'

export type ExportContainer = 'mp4' | 'webm' | 'gif'
export type ExportHeight = 'native' | 1080 | 720 | 480
export type GifFps = 10 | 15 | 20
export type CompressionMode =
  | { kind: 'copy' }
  | { kind: 'quality'; quality: Quality }
  | { kind: 'size'; targetMB: number }

export interface ExportEdits {
  inSec: number
  outSec: number
  container: ExportContainer
  height: ExportHeight
  mode: CompressionMode
  mute: boolean
  gifFps: GifFps
  gifMaxWidth: number
}

export interface VideoMeta {
  durationSec: number
  width: number
  height: number
  /** Source container from the file extension; anything else is 'other'. */
  container: 'mp4' | 'webm' | 'other'
  sizeBytes: number
}

/** The renderer does not know the source fps; one "frame" is 1/30 s. */
export const FRAME_SEC = 1 / 30
const TRIM_EPSILON = 0.01
const MEDIUM: CompressionMode = { kind: 'quality', quality: 'medium' }

export function defaultEdits(meta: VideoMeta): ExportEdits {
  const sameContainer = meta.container !== 'other'
  return {
    inSec: 0,
    outSec: meta.durationSec,
    container: sameContainer ? meta.container : 'mp4',
    height: 'native',
    mode: sameContainer ? { kind: 'copy' } : MEDIUM,
    mute: false,
    gifFps: 15,
    gifMaxWidth: 640
  }
}

export function isTrimmed(e: ExportEdits, meta: VideoMeta): boolean {
  return e.inSec > TRIM_EPSILON || e.outSec < meta.durationSec - TRIM_EPSILON
}

/** Stream copy is only possible when nothing but the range changes. */
export function canCopy(e: ExportEdits, meta: VideoMeta): boolean {
  return e.container === meta.container && e.height === 'native' && !e.mute
}

export function normalizeEdits(e: ExportEdits, meta: VideoMeta): ExportEdits {
  const inSec = Math.min(Math.max(0, e.inSec), meta.durationSec - FRAME_SEC)
  const outSec = Math.min(Math.max(inSec + FRAME_SEC, e.outSec), meta.durationSec)
  const height = e.height !== 'native' && e.height >= meta.height ? 'native' : e.height
  const gif = e.container === 'gif'
  const mute = gif ? false : e.mute
  const next = { ...e, inSec, outSec, height, mute }
  // "Original" (stream copy) only survives while it is actually possible.
  const mode = e.mode.kind === 'copy' && (gif || !canCopy(next, meta)) ? MEDIUM : e.mode
  return { ...next, mode }
}

export function planExport(
  e: ExportEdits,
  meta: VideoMeta,
  input: string,
  output: string
): { kind: 'copy' | 'gif' | 'transcode'; args: string[] } {
  const trimmed = isTrimmed(e, meta)
  const range = trimmed ? { inSec: e.inSec, outSec: e.outSec } : {}

  if (e.container === 'gif') {
    return {
      kind: 'gif',
      args: gifArgs(input, output, { fps: e.gifFps, width: Math.min(e.gifMaxWidth, meta.width), ...range })
    }
  }
  if (e.mode.kind === 'copy' && canCopy(e, meta)) {
    return {
      kind: 'copy',
      args: trimmed
        ? trimArgs(input, output, e.inSec, e.outSec)
        : ['-i', input, '-c', 'copy', '-avoid_negative_ts', 'make_zero', output]
    }
  }
  return {
    kind: 'transcode',
    args: transcodeArgs(input, output, {
      container: e.container,
      height: e.height === 'native' ? undefined : e.height,
      quality: e.mode.kind === 'quality' ? e.mode.quality : undefined,
      targetMB: e.mode.kind === 'size' ? e.mode.targetMB : undefined,
      durationSec: meta.durationSec,
      mute: e.mute,
      ...range
    })
  }
}

// Rough bits per pixel per frame for H.264/VP9 screen content at each CRF tier.
const BPP: Record<Quality, number> = { high: 0.12, medium: 0.08, low: 0.05 }
const GIF_BYTES_PER_PIXEL_FRAME = 0.12
const AUDIO_BPS = 128_000
const ASSUMED_FPS = 30

/** Live estimate for the panel — order-of-magnitude, labelled "≈" in the UI. */
export function estimateBytes(e: ExportEdits, meta: VideoMeta): number {
  const seconds = Math.max(0, e.outSec - e.inSec)
  const scale = e.height === 'native' ? 1 : Math.min(1, e.height / meta.height)
  const w = Math.round(meta.width * scale)
  const h = Math.round(meta.height * scale)

  if (e.container === 'gif') {
    const gw = Math.min(e.gifMaxWidth, meta.width)
    const gh = Math.round((meta.height * gw) / meta.width)
    return Math.round(gw * gh * e.gifFps * seconds * GIF_BYTES_PER_PIXEL_FRAME)
  }
  if (e.mode.kind === 'size') return e.mode.targetMB * 1_000_000
  if (e.mode.kind === 'copy') return Math.round((meta.sizeBytes * seconds) / meta.durationSec)
  const video = (w * h * ASSUMED_FPS * BPP[e.mode.quality] * seconds) / 8
  const audio = e.mute ? 0 : (AUDIO_BPS * seconds) / 8
  return Math.round(video + audio)
}
```

- [ ] **Step 4: Run** the test file → 17 passed.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/shared/videoPlan.ts src/shared/videoPlan.test.ts
git commit -m "feat(shared): video export model and pure planners (copy/gif/transcode, size estimate)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Range-capable video route on the `app://` scheme

**Files:**
- Create: `src/main/videoServe.ts`
- Create: `src/main/videoServe.test.ts`
- Modify: `src/main/protocol.ts`
- Modify: `src/main/index.ts` (call `serveApp()` always instead of `serveRenderer()` in packaged only)

**Interfaces:**
- Produces:
  ```ts
  // src/main/videoServe.ts
  export type Range = { start: number; end: number }
  export function parseRange(header: string | null, size: number): Range | null | 'invalid'
  export function allowVideoPath(path: string): void
  export function isVideoPathAllowed(path: string): boolean
  export function videoUrl(path: string): string           // `${APP_URL}/video?path=<encoded>`
  export function serveVideo(request: Request): Promise<Response>
  // src/main/protocol.ts
  export function serveApp(): void                          // replaces serveRenderer(); register in dev too
  ```

- [ ] **Step 1: Failing tests for `parseRange`**

```ts
// src/main/videoServe.test.ts
import { describe, expect, it, vi } from 'vitest'
// videoServe imports APP_URL from protocol.ts, which imports electron — mock it.
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd() }, net: {}, protocol: {} }))
import { parseRange } from './videoServe'

describe('parseRange', () => {
  it('no header → whole file', () => expect(parseRange(null, 100)).toBeNull())
  it('closed range', () => expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 }))
  it('open-ended range runs to the last byte', () =>
    expect(parseRange('bytes=100-', 1000)).toEqual({ start: 100, end: 999 }))
  it('end past the size is clamped', () =>
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 }))
  it('suffix range', () => expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 }))
  it('start beyond the size is unsatisfiable', () => expect(parseRange('bytes=1000-', 1000)).toBe('invalid'))
  it('garbage is unsatisfiable', () => expect(parseRange('bytes=abc', 1000)).toBe('invalid'))
  it('only the first range of a multi-range request is honoured', () =>
    expect(parseRange('bytes=0-9,20-29', 1000)).toEqual({ start: 0, end: 9 }))
})
```

Run: `npx vitest run src/main/videoServe.test.ts` → FAIL.

- [ ] **Step 2: Implement `videoServe.ts`**

```ts
// src/main/videoServe.ts
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { extname } from 'path'
import { Readable } from 'stream'
import { APP_URL } from './protocol'

/**
 * Streams a video file to the editor renderer over app://bundle/video?path=…
 * with HTTP Range support (needed for seeking). Only paths main explicitly
 * allow-listed via allowVideoPath() are served — the renderer never gets to
 * pick arbitrary files.
 */

export type Range = { start: number; end: number }

const allowed = new Set<string>()

export function allowVideoPath(path: string): void {
  allowed.add(path)
}
export function isVideoPathAllowed(path: string): boolean {
  return allowed.has(path)
}
export function videoUrl(path: string): string {
  return `${APP_URL}/video?path=${encodeURIComponent(path)}`
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska'
}

/** RFC 7233 single range. null = no Range header; 'invalid' = 416. */
export function parseRange(header: string | null, size: number): Range | null | 'invalid' {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid'
  if (m[1] === '') {
    const suffix = Number(m[2])
    if (suffix === 0) return 'invalid'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(m[1])
  if (start >= size) return 'invalid'
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  if (end < start) return 'invalid'
  return { start, end }
}

export async function serveVideo(request: Request): Promise<Response> {
  const path = new URL(request.url).searchParams.get('path')
  if (!path || !allowed.has(path)) return new Response('forbidden', { status: 403 })
  const info = await stat(path).catch(() => null)
  if (!info || !info.isFile()) return new Response('not found', { status: 404 })

  const range = parseRange(request.headers.get('range'), info.size)
  if (range === 'invalid') {
    return new Response('range not satisfiable', {
      status: 416,
      headers: { 'Content-Range': `bytes */${info.size}` }
    })
  }
  const { start, end } = range ?? { start: 0, end: info.size - 1 }
  const headers: Record<string, string> = {
    'Content-Type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1)
  }
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`
  const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
  return new Response(body, { status: range ? 206 : 200, headers })
}
```

- [ ] **Step 3: Route it in `protocol.ts` and register in dev too**

Replace `serveRenderer` with:

```ts
import { serveVideo } from './videoServe'

/**
 * Call after ready — in dev AND packaged. Dev pages come from Vite, but the
 * /video route must exist everywhere; packaged builds also get the bundle.
 */
export function serveApp(): void {
  const root = normalize(join(__dirname, '../renderer'))
  const dev = Boolean(process.env['ELECTRON_RENDERER_URL'])
  protocol.handle(APP_SCHEME, (request) => {
    const { pathname } = new URL(request.url)
    if (pathname === '/video') return serveVideo(request)
    if (dev) return new Response('not found', { status: 404 })
    const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname)
    const target = normalize(join(root, rel))
    // No path traversal outside the renderer bundle.
    if (target !== root && !target.startsWith(root + sep)) {
      return new Response('forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(target).toString())
  })
}
```

Add `stream: true` to the scheme privileges in `registerAppScheme` (media streaming). `APP_URL` stays exported (videoServe imports it — no cycle problem: protocol.ts imports videoServe for `serveVideo`, videoServe imports the `APP_URL` constant; both are plain modules).

`src/main/index.ts`: replace `if (!RENDERER_DEV_URL) serveRenderer()` with `serveApp()` and fix the import.

- [ ] **Step 4: Run** `npx vitest run src/main/videoServe.test.ts` → 8 passed; `npm run typecheck && npm run lint && npm test` green.

Quick manual check that the route works from a renderer (dev): `npm run dev -- -- --user-data-dir=/tmp/snapkit-dev`, in the home window devtools: `fetch('app://bundle/video?path=/etc/hosts').then(r => r.status)` → `403` (not allow-listed). The allow-listed case is exercised by the editor in Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/main/videoServe.ts src/main/videoServe.test.ts src/main/protocol.ts src/main/index.ts
git commit -m "feat(main): range-capable app://bundle/video route with a path allow-list

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Editor window, export IPC, recording handoff, tray entry

**Files:**
- Modify: `src/shared/ipc.ts` (channels, payloads, `VideoApi`)
- Create: `src/main/video.ts`
- Create: `src/main/recordingsPrune.ts`, `src/main/recordingsPrune.test.ts` (pure, no electron import — `video.ts` pulls in electron-store via prefs, which vitest cannot load)
- Modify: `src/main/recorder.ts` (`saveRecording` → `finalizeRecording`)
- Modify: `src/main/index.ts`, `src/main/tray.ts`
- Modify: `src/preload/index.ts`, `src/renderer/src/env.d.ts`
- Modify: `electron.vite.config.ts`
- Create: `src/renderer/video.html`, `src/renderer/src/video/main.tsx` (placeholder that only proves the window loads — Task 4 replaces it)

**Interfaces:**
- Consumes: Task 1 `ExportEdits`, `VideoMeta`, `planExport`; Task 2 `allowVideoPath`, `videoUrl`; V0 `runFfmpeg`, `ffmpegPath`.
- Produces:
  ```ts
  // src/shared/ipc.ts
  videoOpen: 'video:open'          // main → editor: VideoOpenPayload
  videoExport: 'video:export'      // editor → main (invoke): VideoExportRequest → VideoExportResult
  videoProgress: 'video:progress'  // main → editor: number 0..1
  videoCancel: 'video:cancel'      // editor → main
  videoPickFile: 'video:pick-file' // editor → main (invoke): opens a file → openVideo; returns boolean
  videoOpenPath: 'video:open-path' // editor → main: a dropped file's path (from webUtils.getPathForFile)
  export interface VideoOpenPayload { path: string; url: string; name: string; sizeBytes: number; container: 'mp4' | 'webm' | 'other'; ffmpegAvailable: boolean }
  export interface VideoExportRequest { path: string; edits: ExportEdits; meta: VideoMeta }
  export type VideoExportResult = { ok: true; output: string } | { ok: false; error: string; canceled?: boolean }
  export interface VideoApi {
    onOpen: (cb: (p: VideoOpenPayload) => void) => () => void
    export: (req: VideoExportRequest) => Promise<VideoExportResult>
    onProgress: (cb: (ratio: number) => void) => () => void
    cancel: () => void
    pickFile: () => Promise<boolean>
    openDropped: (file: File) => void
  }
  // src/main/video.ts
  export function initVideo(): void                 // IPC handlers + prune
  export function openVideo(filePath: string): void
  export function pickAndOpenVideo(parent?: BrowserWindow): Promise<boolean>
  export async function finalizeRecording(buffer: Buffer, ext: 'mp4' | 'webm'): Promise<void>
  // src/main/recordingsPrune.ts
  export const RECORDINGS_MAX_AGE_MS = 7 * 86_400_000
  export function staleRecordings(entries: { path: string; mtimeMs: number }[], nowMs: number, maxAgeMs?: number): string[]
  ```

- [ ] **Step 1: Failing test for the prune rule**

```ts
// src/main/recordingsPrune.test.ts
import { describe, expect, it } from 'vitest'
import { staleRecordings } from './recordingsPrune'

const DAY = 86_400_000
describe('staleRecordings', () => {
  it('returns files older than 7 days, keeps newer ones', () => {
    const now = 10 * DAY
    const out = staleRecordings(
      [
        { path: 'a.mp4', mtimeMs: now - 8 * DAY },
        { path: 'b.mp4', mtimeMs: now - 6 * DAY },
        { path: 'c.webm', mtimeMs: now - 7 * DAY - 1 }
      ],
      now
    )
    expect(out).toEqual(['a.mp4', 'c.webm'])
  })
})
```

Run: `npx vitest run src/main/recordingsPrune.test.ts` → FAIL. Then create the module:

```ts
// src/main/recordingsPrune.ts
/** Finished recordings wait in userData/recordings until exported; sweep old ones at startup. */
export const RECORDINGS_MAX_AGE_MS = 7 * 86_400_000

/** Pure: which recordings are older than maxAge. */
export function staleRecordings(
  entries: { path: string; mtimeMs: number }[],
  nowMs: number,
  maxAgeMs: number = RECORDINGS_MAX_AGE_MS
): string[] {
  return entries.filter((e) => nowMs - e.mtimeMs > maxAgeMs).map((e) => e.path)
}
```
Run the test again → 1 passed.

- [ ] **Step 2: IPC types** — add the channels, payload types and `VideoApi` above to `src/shared/ipc.ts` (import `ExportEdits`, `VideoMeta` from `./videoPlan`).

- [ ] **Step 3: `src/main/video.ts`**

```ts
// src/main/video.ts
import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { existsSync } from 'fs'
import { mkdir, readdir, rm, stat, writeFile } from 'fs/promises'
import { basename, extname, join, parse } from 'path'
import { IpcChannels, type VideoExportRequest, type VideoExportResult, type VideoOpenPayload } from '@shared/ipc'
import { planExport } from '@shared/videoPlan'
import { ffmpegPath, runFfmpeg } from './ffmpeg'
import { getPrefs } from './prefs'
import { APP_URL } from './protocol'
import { allowVideoPath, videoUrl } from './videoServe'
import { staleRecordings } from './recordingsPrune'

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']
const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'webm', 'mov', 'mkv']

let win: BrowserWindow | null = null
let exportAbort: AbortController | null = null

const containerOf = (path: string): VideoOpenPayload['container'] => {
  const ext = extname(path).toLowerCase()
  return ext === '.mp4' || ext === '.m4v' ? 'mp4' : ext === '.webm' ? 'webm' : 'other'
}

export function initVideo(): void {
  ipcMain.handle(IpcChannels.videoExport, (event, req: VideoExportRequest) => exportVideo(event.sender, req))
  ipcMain.on(IpcChannels.videoCancel, () => exportAbort?.abort())
  ipcMain.handle(IpcChannels.videoPickFile, (event) =>
    pickAndOpenVideo(BrowserWindow.fromWebContents(event.sender) ?? undefined)
  )
  ipcMain.on(IpcChannels.videoOpenPath, (_event, path: string) => {
    if (VIDEO_EXTENSIONS.includes(extname(path).slice(1).toLowerCase())) openVideo(path)
  })
  void pruneRecordings()
}

function ensureWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win
  win = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 12, y: 14 } }
      : { frame: false }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.on('closed', () => {
    win = null
    exportAbort?.abort()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  void win.loadURL(RENDERER_DEV_URL ? `${RENDERER_DEV_URL}/video.html` : `${APP_URL}/video.html`)
  return win
}

export function openVideo(filePath: string): void {
  const w = ensureWindow()
  allowVideoPath(filePath)
  void stat(filePath).then((info) => {
    const payload: VideoOpenPayload = {
      path: filePath,
      url: videoUrl(filePath),
      name: basename(filePath),
      sizeBytes: info.size,
      container: containerOf(filePath),
      ffmpegAvailable: existsSync(ffmpegPath())
    }
    const wc = w.webContents
    const send = (): void => wc.send(IpcChannels.videoOpen, payload)
    if (wc.isLoading()) wc.once('did-finish-load', send)
    else send()
    w.show()
    w.focus()
  })
}

export async function pickAndOpenVideo(parent?: BrowserWindow): Promise<boolean> {
  const options = {
    properties: ['openFile' as const],
    filters: [{ name: 'Video', extensions: VIDEO_EXTENSIONS }]
  }
  const { canceled, filePaths } = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  if (canceled || filePaths.length === 0) return false
  openVideo(filePaths[0])
  return true
}

async function exportVideo(
  sender: Electron.WebContents,
  { path, edits, meta }: VideoExportRequest
): Promise<VideoExportResult> {
  if (exportAbort) return { ok: false, error: 'An export is already running.' }
  const prefs = getPrefs()
  const { name } = parse(path)
  const filters = {
    mp4: { name: 'MP4 video', extensions: ['mp4'] },
    webm: { name: 'WebM video', extensions: ['webm'] },
    gif: { name: 'GIF', extensions: ['gif'] }
  }
  const owner = BrowserWindow.fromWebContents(sender)
  const options = {
    defaultPath: join(prefs.exportDir ?? app.getPath('desktop'), `${name} (edited).${edits.container}`),
    filters: [filters[edits.container]]
  }
  const { canceled, filePath } = owner
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options)
  if (canceled || !filePath) return { ok: false, error: 'canceled', canceled: true }

  const plan = planExport(edits, meta, path, filePath)
  exportAbort = new AbortController()
  try {
    await runFfmpeg({
      args: plan.args,
      durationSec: Math.max(0.1, edits.outSec - edits.inSec),
      signal: exportAbort.signal,
      onProgress: (ratio) => {
        if (!sender.isDestroyed()) sender.send(IpcChannels.videoProgress, ratio)
      }
    })
    shell.showItemInFolder(filePath)
    return { ok: true, output: filePath }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message, canceled: message === 'ffmpeg cancelled' }
  } finally {
    exportAbort = null
  }
}

/** Where finished recordings live until the user exports them. */
const recordingsDir = (): string => join(app.getPath('userData'), 'recordings')

const pad2 = (n: number): string => String(n).padStart(2, '0')

/**
 * Called by the recorder with the raw MediaRecorder bytes. Remuxes them into
 * a seekable file (fragmented mp4/webm has no duration header) and opens the
 * editor on it. Falls back to the raw bytes if ffmpeg fails.
 */
export async function finalizeRecording(buffer: Buffer, ext: 'mp4' | 'webm'): Promise<void> {
  const d = new Date()
  const stamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} at ${pad2(d.getHours())}.${pad2(d.getMinutes())}.${pad2(d.getSeconds())}`
  const dir = recordingsDir()
  await mkdir(dir, { recursive: true })
  const final = join(dir, `Snapkit Recording ${stamp}.${ext}`)
  const raw = join(dir, `.raw-${Date.now()}.${ext}`)
  try {
    await writeFile(raw, buffer)
    await runFfmpeg({
      args: ['-i', raw, '-c', 'copy', ...(ext === 'mp4' ? ['-movflags', '+faststart'] : []), final]
    })
  } catch (err) {
    console.warn('[video] remux failed, keeping the raw recording:', err)
    try {
      await writeFile(final, buffer)
    } catch (writeErr) {
      new Notification({
        title: 'Could not save recording',
        body: writeErr instanceof Error ? writeErr.message : String(writeErr)
      }).show()
      return
    }
  } finally {
    await rm(raw, { force: true }).catch(() => undefined)
  }
  openVideo(final)
}

// ponytail: 7-day sweep at startup; a "Recordings" browser in the editor if people ask.
async function pruneRecordings(): Promise<void> {
  const dir = recordingsDir()
  const names = await readdir(dir).catch(() => [] as string[])
  const entries = await Promise.all(
    names.map(async (n) => ({ path: join(dir, n), mtimeMs: (await stat(join(dir, n))).mtimeMs }))
  )
  for (const p of staleRecordings(entries, Date.now())) await rm(p, { force: true }).catch(() => undefined)
}
```

- [ ] **Step 4: Recorder handoff** — in `src/main/recorder.ts` replace the whole `saveRecording` function and its call with `void finalizeRecording(buffer, ext)` (import from `./video`). Remove now-unused imports (`dialog`, `shell`, `writeFile`, `rm`, `runFfmpeg`, `app` if unused, `pad2`, `type EditorHost`). The `host` parameter of `registerRecorderIpc` becomes unused → drop it and update the call in `index.ts` (`registerRecorderIpc()`).

- [ ] **Step 5: Wiring** — `src/main/index.ts`: `import { initVideo, pickAndOpenVideo } from './video'`; call `initVideo()` after `registerRecorderIpc()`; tray action `editVideo: () => void pickAndOpenVideo()`. `src/main/tray.ts`: `TrayActions.editVideo`, menu item `{ label: 'Edit Video…', click: actions.editVideo }` after "Record Window…".

- [ ] **Step 6: Preload + env + vite input + placeholder page**

`src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
// …
const videoApi: VideoApi = {
  onOpen: (cb) => on<VideoOpenPayload>(IpcChannels.videoOpen, cb),
  export: (req) => ipcRenderer.invoke(IpcChannels.videoExport, req),
  onProgress: (cb) => on<number>(IpcChannels.videoProgress, cb),
  cancel: () => ipcRenderer.send(IpcChannels.videoCancel),
  pickFile: () => ipcRenderer.invoke(IpcChannels.videoPickFile),
  // Sandboxed renderers have no File.path; the preload resolves it.
  openDropped: (file) => ipcRenderer.send(IpcChannels.videoOpenPath, webUtils.getPathForFile(file))
}
contextBridge.exposeInMainWorld('videoApi', videoApi)   // plus the fallback branch
```
`src/renderer/src/env.d.ts`: `videoApi: VideoApi`. `electron.vite.config.ts`: `video: resolve(__dirname, 'src/renderer/video.html')`.

`src/renderer/video.html` (same shape as `history.html`, title "Snapkit — Video", script `./src/video/main.tsx`). Placeholder `src/renderer/src/video/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import '../index.css'

function Placeholder(): React.JSX.Element {
  const [name, setName] = React.useState('waiting for a file…')
  React.useEffect(() => window.videoApi.onOpen((p) => setName(`${p.name} (${p.sizeBytes} bytes)`)), [])
  return <div className="p-6 text-sm">{name}</div>
}
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<Placeholder />)
```

- [ ] **Step 7: Verify, smoke, commit**

`npx vitest run src/main/recordingsPrune.test.ts` → 1 passed; `npm run typecheck && npm run lint && npm test` green.
Manual: `npm run dev -- -- --user-data-dir=/tmp/snapkit-dev` → tray "Edit Video…" → pick an mp4 → the video window opens showing its name and size. Record Area → Done → the window opens on `Snapkit Recording ….mp4` (check the file exists under `/tmp/snapkit-dev/recordings/`, plays in QuickTime with a duration).

```bash
git add -A src/shared/ipc.ts src/main/video.ts src/main/recordingsPrune.ts src/main/recordingsPrune.test.ts src/main/recorder.ts src/main/index.ts src/main/tray.ts src/preload/index.ts src/renderer/src/env.d.ts electron.vite.config.ts src/renderer/video.html src/renderer/src/video
git commit -m "feat(video): editor window, export IPC with progress/cancel, recordings handoff, tray entry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Editor UI — store, player, export panel

**Files:**
- Create: `src/renderer/src/components/ui/segmented.tsx`, `src/renderer/src/components/ui/toggle.tsx` (moved out of `PrefsPanel.tsx`)
- Modify: `src/renderer/src/PrefsPanel.tsx` (import them; delete the local copies)
- Create: `src/renderer/src/video/store.ts`, `format.ts`, `Player.tsx`, `ExportPanel.tsx`, `VideoEditor.tsx`
- Replace: `src/renderer/src/video/main.tsx`

**Interfaces:**
- Consumes: `window.videoApi` (Task 3), `videoPlan` (Task 1).
- Produces: `useVideoStore` with `{ file, meta, edits, playhead, exporting, result, error, setFile, setMedia, patchEdits, setPlayhead, runExport, cancelExport }`; `Timeline` (Task 5) plugs into `VideoEditor` between `Player` and the info line.

- [ ] **Step 1: Extract `Segmented` and `Toggle`**

`src/renderer/src/components/ui/segmented.tsx` — move the `Segmented` function from `PrefsPanel.tsx` verbatim (it already accepts `T extends string | number` after V1), `export function Segmented`. Same for `Toggle` → `toggle.tsx`. In `PrefsPanel.tsx` delete both local definitions and add `import { Segmented } from '@renderer/components/ui/segmented'` / `import { Toggle } from '@renderer/components/ui/toggle'`. `npm run typecheck` green before continuing.

- [ ] **Step 2: `format.ts`**

```ts
// src/renderer/src/video/format.ts
export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00.0'
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}
export function fmtBytes(n: number): string {
  if (n < 1_000_000) return `${Math.max(1, Math.round(n / 1000))} KB`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)} MB`
}
```

- [ ] **Step 3: `store.ts`**

```ts
// src/renderer/src/video/store.ts
import { create } from 'zustand'
import type { VideoExportResult, VideoOpenPayload } from '@shared/ipc'
import { defaultEdits, normalizeEdits, type ExportEdits, type VideoMeta } from '@shared/videoPlan'

interface VideoState {
  file: VideoOpenPayload | null
  /** null until <video> fired loadedmetadata. */
  meta: VideoMeta | null
  edits: ExportEdits | null
  playhead: number
  exporting: { progress: number } | null
  result: VideoExportResult | null
  /** Source problems (missing file, decode error) — export disabled while set. */
  sourceError: string | null

  setFile: (file: VideoOpenPayload) => void
  setMedia: (m: { durationSec: number; width: number; height: number }) => void
  setSourceError: (msg: string | null) => void
  patchEdits: (patch: Partial<ExportEdits>) => void
  setPlayhead: (t: number) => void
  runExport: () => Promise<void>
  cancelExport: () => void
}

export const useVideoStore = create<VideoState>((set, get) => ({
  file: null,
  meta: null,
  edits: null,
  playhead: 0,
  exporting: null,
  result: null,
  sourceError: null,

  setFile: (file) => set({ file, meta: null, edits: null, playhead: 0, result: null, sourceError: null }),
  setMedia: ({ durationSec, width, height }) => {
    const { file } = get()
    if (!file) return
    const meta: VideoMeta = { durationSec, width, height, container: file.container, sizeBytes: file.sizeBytes }
    set({ meta, edits: defaultEdits(meta) })
  },
  setSourceError: (sourceError) => set({ sourceError }),
  patchEdits: (patch) => {
    const { edits, meta } = get()
    if (!edits || !meta) return
    set({ edits: normalizeEdits({ ...edits, ...patch }, meta), result: null })
  },
  setPlayhead: (playhead) => set({ playhead }),
  runExport: async () => {
    const { file, edits, meta, exporting } = get()
    if (!file || !edits || !meta || exporting) return
    set({ exporting: { progress: 0 }, result: null })
    const result = await window.videoApi.export({ path: file.path, edits, meta })
    set({ exporting: null, result: result.ok || !result.canceled ? result : null })
  },
  cancelExport: () => window.videoApi.cancel()
}))
```

- [ ] **Step 4: `Player.tsx`** — native controls; reports metadata, time and errors to the store; exposes the element through a ref so the timeline can seek.

```tsx
// src/renderer/src/video/Player.tsx
import { forwardRef } from 'react'
import { useVideoStore } from './store'

export const Player = forwardRef<HTMLVideoElement, { src: string }>(function Player({ src }, ref) {
  const setMedia = useVideoStore((s) => s.setMedia)
  const setPlayhead = useVideoStore((s) => s.setPlayhead)
  const setSourceError = useVideoStore((s) => s.setSourceError)
  return (
    <video
      ref={ref}
      src={src}
      controls
      playsInline
      className="max-h-full max-w-full rounded-md bg-black"
      onLoadedMetadata={(e) => {
        const v = e.currentTarget
        setSourceError(null)
        setMedia({ durationSec: v.duration, width: v.videoWidth, height: v.videoHeight })
      }}
      onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)}
      onError={() => setSourceError('File moved, deleted or not decodable.')}
    />
  )
})
```

- [ ] **Step 5: `ExportPanel.tsx`**

```tsx
// src/renderer/src/video/ExportPanel.tsx
import { Button } from '@renderer/components/ui/button'
import { Segmented } from '@renderer/components/ui/segmented'
import { Toggle } from '@renderer/components/ui/toggle'
import { canCopy, estimateBytes, type ExportHeight, type GifFps } from '@shared/videoPlan'
import { fmtBytes, fmtTime } from './format'
import { useVideoStore } from './store'

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

export function ExportPanel(): React.JSX.Element {
  const { file, meta, edits, exporting, result, sourceError, patchEdits, runExport, cancelExport } =
    useVideoStore()
  if (!file || !meta || !edits) return <aside className="w-72 border-l p-4 text-xs text-muted-foreground">Loading…</aside>

  const gif = edits.container === 'gif'
  const copyOk = canCopy(edits, meta)
  const heights = ([1080, 720, 480] as const).filter((h) => h < meta.height)
  const modeValue = edits.mode.kind === 'copy' ? 'copy' : edits.mode.kind === 'size' ? 'size' : edits.mode.quality
  const canExport = file.ffmpegAvailable && !sourceError && !exporting

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l">
      <div className="flex-1 overflow-y-auto divide-y px-4">
        <Row label="Format">
          <Segmented
            ariaLabel="Format"
            value={edits.container}
            options={[{ value: 'mp4', label: 'MP4' }, { value: 'webm', label: 'WebM' }, { value: 'gif', label: 'GIF' }]}
            onChange={(container) => patchEdits({ container })}
          />
        </Row>
        {!gif && (
          <Row label="Resolution">
            <Segmented<ExportHeight>
              ariaLabel="Resolution"
              value={edits.height}
              options={[{ value: 'native', label: 'Native' }, ...heights.map((h) => ({ value: h, label: `${h}p` }))]}
              onChange={(height) => patchEdits({ height })}
            />
          </Row>
        )}
        {!gif && (
          <Row label="Compression">
            <Segmented
              ariaLabel="Compression"
              value={modeValue}
              options={[
                ...(copyOk ? [{ value: 'copy', label: 'Original' }] : []),
                { value: 'high', label: 'High' },
                { value: 'medium', label: 'Med' },
                { value: 'low', label: 'Low' },
                { value: 'size', label: 'Size' }
              ]}
              onChange={(v) =>
                patchEdits({
                  mode:
                    v === 'copy'
                      ? { kind: 'copy' }
                      : v === 'size'
                        ? { kind: 'size', targetMB: 10 }
                        : { kind: 'quality', quality: v as 'high' | 'medium' | 'low' }
                })
              }
            />
          </Row>
        )}
        {!gif && edits.mode.kind === 'size' && (
          <Row label="Target size">
            <input
              type="number"
              min={1}
              step={1}
              value={edits.mode.targetMB}
              onChange={(e) => patchEdits({ mode: { kind: 'size', targetMB: Math.max(1, Number(e.target.value) || 1) } })}
              className="h-8 w-20 rounded-md border bg-background px-2 text-right text-xs"
              aria-label="Target size in megabytes"
            />
            <span className="text-xs text-muted-foreground">MB</span>
          </Row>
        )}
        {!gif && (
          <Row label="Mute audio">
            <Toggle ariaLabel="Mute audio" checked={edits.mute} onChange={(mute) => patchEdits({ mute })} />
          </Row>
        )}
        {gif && (
          <Row label="GIF frame rate">
            <Segmented<GifFps>
              ariaLabel="GIF frame rate"
              value={edits.gifFps}
              options={[{ value: 10, label: '10' }, { value: 15, label: '15' }, { value: 20, label: '20' }]}
              onChange={(gifFps) => patchEdits({ gifFps })}
            />
          </Row>
        )}
        {gif && (
          <Row label="GIF max width">
            <Segmented
              ariaLabel="GIF max width"
              value={edits.gifMaxWidth}
              options={[{ value: 480, label: '480' }, { value: 640, label: '640' }, { value: 960, label: '960' }]}
              onChange={(gifMaxWidth) => patchEdits({ gifMaxWidth })}
            />
          </Row>
        )}
        <Row label="Range">
          <span className="font-mono text-xs">{fmtTime(edits.inSec)} → {fmtTime(edits.outSec)}</span>
        </Row>
        <Row label="Estimated size">
          <span className="font-mono text-xs">≈ {fmtBytes(estimateBytes(edits, meta))}</span>
        </Row>
      </div>

      <div className="space-y-2 border-t p-4">
        {exporting ? (
          <>
            <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(exporting.progress * 100)}%` }} />
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={cancelExport}>Cancel</Button>
          </>
        ) : (
          <Button className="w-full" disabled={!canExport} onClick={() => void runExport()}>
            Export…
          </Button>
        )}
        {!file.ffmpegAvailable && <p className="text-xs text-destructive">ffmpeg is missing — reinstall Snapkit to export.</p>}
        {sourceError && <p className="text-xs text-destructive">{sourceError}</p>}
        {result && !result.ok && <p className="break-words text-xs text-destructive">{result.error}</p>}
        {result?.ok && <p className="truncate text-xs text-muted-foreground" title={result.output}>Saved: {result.output}</p>}
      </div>
    </aside>
  )
}
```

- [ ] **Step 6: `VideoEditor.tsx` and `main.tsx`**

```tsx
// src/renderer/src/video/VideoEditor.tsx
import { useEffect, useRef } from 'react'
import { FolderOpen } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { dragRegion, noDrag } from '@renderer/lib/titlebar'
import { ExportPanel } from './ExportPanel'
import { Player } from './Player'
import { fmtBytes, fmtTime } from './format'
import { useVideoStore } from './store'

export function VideoEditor(): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { file, meta, setFile } = useVideoStore()

  useEffect(() => window.videoApi.onOpen(setFile), [setFile])
  useEffect(() => {
    const off = window.videoApi.onProgress((progress) =>
      useVideoStore.setState((s) => (s.exporting ? { exporting: { progress } } : {}))
    )
    return off
  }, [])

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) window.videoApi.openDropped(f)
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header style={dragRegion} className="flex h-11 shrink-0 items-center gap-3 border-b px-3 pl-20">
        <span className="truncate text-xs font-medium text-muted-foreground">{file?.name ?? 'Snapkit Video'}</span>
        <div className="ml-auto" style={noDrag}>
          <Button variant="ghost" size="sm" onClick={() => void window.videoApi.pickFile()}>
            <FolderOpen /> Open…
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {file ? <Player ref={videoRef} src={file.url} /> : <p className="text-sm text-muted-foreground">Drop a video here or use Open…</p>}
          </div>
          {/* Timeline mounts here in Task 5: <Timeline videoRef={videoRef} /> */}
          {file && meta && (
            <p className="font-mono text-[11px] text-muted-foreground">
              {meta.width}×{meta.height} · {fmtTime(meta.durationSec)} · {fmtBytes(meta.sizeBytes)}
            </p>
          )}
        </main>
        <ExportPanel />
      </div>
    </div>
  )
}
```

```tsx
// src/renderer/src/video/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { VideoEditor } from './VideoEditor'
import '../index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <VideoEditor />
  </React.StrictMode>
)
```

- [ ] **Step 7: Verify, smoke, commit**

`npm run typecheck && npm run lint && npm test` green. Manual (`npm run dev -- -- --user-data-dir=/tmp/snapkit-dev`): open an mp4 via tray → plays with native controls, seeking works (Range route), info line shows size/duration; Export with "Original" → save dialog → instant file; switch to WebM Medium 720p → progress bar moves, file saved and revealed; Cancel mid-export → no partial file left; GIF 10 fps 480 → gif saved; drop a file onto the window → it opens.

```bash
git add -A src/renderer/src/components/ui src/renderer/src/PrefsPanel.tsx src/renderer/src/video
git commit -m "feat(video): editor UI — player, export panel, progress, drag & drop

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Timeline — filmstrip, in/out handles, keyboard

**Files:**
- Create: `src/renderer/src/video/filmstrip.ts`, `src/renderer/src/video/Timeline.tsx`
- Modify: `src/renderer/src/video/VideoEditor.tsx` (mount `Timeline`)

**Interfaces:**
- Consumes: store `edits.inSec/outSec`, `playhead`, `patchEdits`, `meta.durationSec`; `FRAME_SEC` from `videoPlan`.
- Produces: `<Timeline videoRef={React.RefObject<HTMLVideoElement | null>} />`.

- [ ] **Step 1: `filmstrip.ts`** — sequential seeks on a hidden video, one canvas per thumb.

```ts
// src/renderer/src/video/filmstrip.ts
/** Draw `count` evenly spaced frames of `src` as JPEG data URLs (hidden <video> + canvas). */
export async function buildFilmstrip(
  src: string,
  durationSec: number,
  count: number,
  thumbWidth: number,
  signal: AbortSignal
): Promise<string[]> {
  const video = document.createElement('video')
  video.src = src
  video.muted = true
  video.preload = 'auto'
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error('filmstrip: cannot load video'))
  })
  const canvas = document.createElement('canvas')
  canvas.width = thumbWidth
  canvas.height = Math.max(1, Math.round((thumbWidth * video.videoHeight) / video.videoWidth))
  const ctx = canvas.getContext('2d')
  if (!ctx) return []

  const out: string[] = []
  for (let i = 0; i < count; i++) {
    if (signal.aborted) break
    const t = ((i + 0.5) / count) * durationSec
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve()
      video.currentTime = Math.min(t, Math.max(0, durationSec - 0.05))
    })
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    out.push(canvas.toDataURL('image/jpeg', 0.6))
  }
  video.removeAttribute('src')
  video.load()
  return out
}
```

- [ ] **Step 2: `Timeline.tsx`**

```tsx
// src/renderer/src/video/Timeline.tsx
import { useEffect, useRef, useState, type RefObject } from 'react'
import { FRAME_SEC } from '@shared/videoPlan'
import { cn } from '@renderer/lib/utils'
import { buildFilmstrip } from './filmstrip'
import { fmtTime } from './format'
import { useVideoStore } from './store'

const THUMBS = 20

export function Timeline({ videoRef }: { videoRef: RefObject<HTMLVideoElement | null> }): React.JSX.Element | null {
  const { file, meta, edits, playhead, patchEdits } = useVideoStore()
  const [thumbs, setThumbs] = useState<string[]>([])
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef<'in' | 'out' | null>(null)

  // Filmstrip: rebuilt when the file changes; aborted if it changes again mid-way.
  useEffect(() => {
    setThumbs([])
    if (!file || !meta) return
    const ac = new AbortController()
    void buildFilmstrip(file.url, meta.durationSec, THUMBS, 160, ac.signal).then((t) => {
      if (!ac.signal.aborted) setThumbs(t)
    })
    return () => ac.abort()
  }, [file, meta])

  // Keyboard: I/O set in/out at the playhead, [ ] nudge the nearer handle, Space toggles play.
  useEffect(() => {
    if (!meta || !edits) return
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      const v = videoRef.current
      const t = v?.currentTime ?? playhead
      if (e.key === 'i' || e.key === 'I') patchEdits({ inSec: t })
      else if (e.key === 'o' || e.key === 'O') patchEdits({ outSec: t })
      else if (e.key === '[' || e.key === ']') {
        const delta = e.key === '[' ? -FRAME_SEC : FRAME_SEC
        const nearerIsIn = Math.abs(t - edits.inSec) <= Math.abs(t - edits.outSec)
        patchEdits(nearerIsIn ? { inSec: edits.inSec + delta } : { outSec: edits.outSec + delta })
      } else if (e.key === ' ' && v) {
        e.preventDefault()
        if (v.paused) void v.play()
        else v.pause()
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [meta, edits, playhead, patchEdits, videoRef])

  if (!file || !meta || !edits) return null
  const dur = meta.durationSec
  const pct = (sec: number): number => (dur > 0 ? (sec / dur) * 100 : 0)

  const secAt = (clientX: number): number => {
    const el = trackRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    return Math.min(dur, Math.max(0, ((clientX - r.left) / r.width) * dur))
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (!dragging.current) return
    const t = secAt(e.clientX)
    patchEdits(dragging.current === 'in' ? { inSec: t } : { outSec: t })
    if (videoRef.current) videoRef.current.currentTime = t
  }
  const startDrag = (which: 'in' | 'out') => (e: React.PointerEvent): void => {
    dragging.current = which
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const endDrag = (): void => {
    dragging.current = null
  }
  const seek = (e: React.MouseEvent): void => {
    if (dragging.current || !videoRef.current) return
    videoRef.current.currentTime = secAt(e.clientX)
  }

  return (
    <div className="shrink-0 select-none">
      <div
        ref={trackRef}
        className="relative h-16 overflow-hidden rounded-md border bg-muted"
        onClick={seek}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="flex h-full">
          {thumbs.length === 0
            ? Array.from({ length: THUMBS }, (_, i) => <div key={i} className="h-full flex-1 animate-pulse border-r border-background/40" />)
            : thumbs.map((src, i) => <img key={i} src={src} alt="" draggable={false} className="h-full flex-1 object-cover" />)}
        </div>
        {/* dimmed outside the range */}
        <div className="pointer-events-none absolute inset-y-0 left-0 bg-background/70" style={{ width: `${pct(edits.inSec)}%` }} />
        <div className="pointer-events-none absolute inset-y-0 right-0 bg-background/70" style={{ width: `${100 - pct(edits.outSec)}%` }} />
        {/* playhead */}
        <div className="pointer-events-none absolute inset-y-0 w-px bg-foreground" style={{ left: `${pct(playhead)}%` }} />
        {/* handles */}
        {(['in', 'out'] as const).map((which) => (
          <div
            key={which}
            role="slider"
            aria-label={which === 'in' ? 'Trim start' : 'Trim end'}
            aria-valuenow={which === 'in' ? edits.inSec : edits.outSec}
            aria-valuemin={0}
            aria-valuemax={dur}
            tabIndex={0}
            onPointerDown={startDrag(which)}
            className={cn(
              'absolute inset-y-0 w-2.5 cursor-ew-resize rounded-sm bg-primary',
              which === 'in' ? '-translate-x-full' : ''
            )}
            style={{ left: `${pct(which === 'in' ? edits.inSec : edits.outSec)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>I {fmtTime(edits.inSec)}</span>
        <span>{fmtTime(playhead)}</span>
        <span>O {fmtTime(edits.outSec)}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Mount it** — in `VideoEditor.tsx` import `Timeline` and replace the comment line with `{file && <Timeline videoRef={videoRef} />}`.

- [ ] **Step 4: Verify, smoke, commit**

`npm run typecheck && npm run lint && npm test` green. Manual: filmstrip fills in within a couple of seconds for a 1-minute file; drag both handles (video seeks along), click the strip to seek, `I`/`O` at the playhead, `[`/`]` nudge, Space toggles; Range in the panel updates; "Original" export of a trimmed range is instant and the result has the expected duration.

```bash
git add src/renderer/src/video
git commit -m "feat(video): filmstrip timeline with in/out handles and keyboard trimming

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Docs and manual smoke sign-off

**Files:**
- Modify: `README.md`, `ROADMAP.md`, spec §3 V3

- [ ] **Step 1: README** — Features: add an **Edit** block: "Trim, resize (1080p/720p/480p), compress (quality or target size), convert to MP4 / WebM / GIF, mute — every recording opens in the editor; any video via tray → Edit Video… or drag & drop." Under-the-hood table: add `| Video editor | app:// range streaming → <video>; ffmpeg stream-copy / transcode / palettegen |`. Usage: recordings land in `~/Library/Application Support/snapkit/recordings` (7-day retention) until exported.
- [ ] **Step 2: ROADMAP** — 3.1 row: `V3 editor ✅`; deferred: "Editor: source fps unknown to the renderer (frame nudge = 1/30 s); recordings browser; crop/speed still out."
- [ ] **Step 3: Spec §3 V3** — "Landed" note: `mode: 'copy'` ("Original") replaces the implicit trim-only rule; `videoOpenPath` for drops via `webUtils.getPathForFile`; recordings dir + prune.
- [ ] **Step 4: Smoke checklist** (do it, tick it in the commit body):
  1. Area recording → editor opens on the remuxed file; duration correct; seek works.
  2. Original + trim → instant export, duration matches the range (keyframe-bound).
  3. MP4 → WebM 720p Medium, muted → plays in Chrome, no audio track.
  4. Target size 5 MB on a 60 s clip → output within ±10 %.
  5. GIF 10 fps 480 wide, 10 s → ≤ 20 MB, loops.
  6. Cancel mid-transcode → no output file, panel back to Export.
  7. Delete the source while the editor is open → "File moved, deleted or not decodable.", Export disabled.
  8. `fetch('app://bundle/video?path=/etc/hosts')` from the editor devtools → 403.
  9. Prefs panel still works (Segmented/Toggle moved).
- [ ] **Step 5: Commit**

```bash
git add README.md ROADMAP.md docs/superpowers/specs/2026-09-03-video-suite-design.md
git commit -m "docs: video editor — features, retention, roadmap status

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
