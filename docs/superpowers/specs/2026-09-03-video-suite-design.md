# Snapkit Video Suite — Design

Date: 2026-09-03 · Status: approved (brainstorm) · Supersedes ROADMAP 3.1

Adds three capabilities to Snapkit: a professional screen recorder (multiple sources,
resolutions, audio), a game-clip tool (replay buffer + hotkey), and a video mini-suite
(trim / resize / compress / convert). Delivered as four milestones, V0–V3, each with its
own implementation plan and pre-code checkpoint.

---

## 1. Goals and non-goals

**Goals**

- Record full screen, a window, or an area to **MP4 (H.264)** at a chosen resolution and
  frame rate, with optional microphone and system audio.
- "Save the last N seconds" game clips (ShadowPlay-style) from a global hotkey, in under
  2 seconds, without the user starting anything beforehand.
- Post-process any video (recorded or dropped in): trim, resize, compress, convert
  mp4 / webm / gif, mute.
- Everything stays local. No new network calls.

**Non-goals (parked in ROADMAP)**

- Video crop, speed change, webcam / face overlay, in-game overlay, automatic game
  detection, cloud upload, Wayland system-audio capture.

---

## 2. Architecture decision: capture native, post-process with ffmpeg

**Capture** uses what Electron already gives us: `getDisplayMedia()` routed through
`session.setDisplayMediaRequestHandler` (no picker), encoded in the renderer by
`MediaRecorder` with `video/mp4;codecs=avc1` (Chromium ≥ 126; Electron 43 ships
Chromium well past that). Hardware H.264 encoding (VideoToolbox on macOS,
MediaFoundation on Windows) comes for free. Chromium owns OS quirks: TCC permission,
ScreenCaptureKit, Windows Graphics Capture, Wayland portals.

**Rejected**: ffmpeg grabbing the screen itself (`avfoundation` / `ddagrab` /
`x11grab`). Better raw throughput, but: TCC attribution for a child process is a risk,
no system audio on macOS/Windows without virtual devices, Wayland unsupported.
Not worth it for a v1.

**Post-processing** uses a bundled static **ffmpeg** binary spawned from the main
process. Used for: segment concat, trim (`-c copy`), scale, bitrate-targeted
re-encode, mp4 ↔ webm ↔ gif (`palettegen` / `paletteuse`). Never used to capture.

**Consequence**: `gifenc` is removed. GIF stops being a _recording_ format and becomes
an _export_ format of the suite (better quality via ffmpeg palettes, no 30 s cap).

### 2.1 ffmpeg bundling

- `scripts/setup-ffmpeg.mjs` (same pattern as `setup-ocr.mjs` / `setup-bgr.mjs`):
  runs in `predev` / `prebuild`, downloads the static-build **archive** for the **host**
  platform, verifies its pinned SHA-256, then extracts the single ffmpeg entry with
  `tar -xOf <archive> <entry>` (bsdtar reads zip on macOS/Windows, GNU tar reads xz on
  Linux) into `resources/ffmpeg/<platform>-<arch>/ffmpeg[.exe]`, chmods it 755, deletes
  the archive and writes the archive hash to a `.sha256` marker next to the binary
  (the extracted binary's own hash is not the pinned one, so the marker is what makes
  the script idempotent). Post-extract it runs `ffmpeg -version` as a sanity check.
- Sources — ffmpeg **9.0.1**, **GPLv3** (`--enable-gpl --enable-version3`, no
  `--enable-nonfree`), pinned per URL in the script:
  - All four archives are served from the pinned mirror
    <https://github.com/simiriva95/snapkit-ffmpeg> (release `9.0.1`), because upstream
    `autobuild-*` tags get pruned. Provenance and checksums live in that repo's README.
  - macOS arm64 / x64: [Martin Riedl](https://ffmpeg.martin-riedl.de/) static builds
    (66 MB / 95 MB extracted; 28 MB / 34 MB archives).
  - Windows x64: BtbN `ffmpeg-n9.0.1-…-win64-gpl-9.0` (145 MB extracted, 169 MB archive).
  - Linux x64: BtbN `ffmpeg-n9.0.1-…-linux64-gpl-9.0` (146 MB extracted, 127 MB archive).
- `electron-builder.yml`: `extraResources: [{ from: resources/ffmpeg/${os}-${arch}, to: ffmpeg }]`
  so only the target platform's binary ships. Executable bit preserved
  (`chmod 755` in the script; builder keeps mode for extraResources).
- Path resolution in main: `app.isPackaged ? join(process.resourcesPath, 'ffmpeg', bin)
: join(app.getAppPath(), 'resources/ffmpeg', `${platform}-${arch}`, bin)`.
- **License**: GPLv3 builds executed as a separate process via CLI, never linked.
  README "Third-party" section lists ffmpeg + GPL + link to its source. This is the
  common industry practice; a lawyer review is a Phase-1 selling item, not a blocker.
- CI release matrix: each runner already builds its own OS, so `setup-ffmpeg.mjs`
  naturally fetches the right binary. No cross-compilation of ffmpeg needed.

### 2.2 New main-process module: `src/main/ffmpeg.ts`

Single wrapper, one exported function:

```ts
export interface FfmpegRun {
  args: string[]
  /** Total duration in seconds, used to turn stderr `time=` into 0..1 progress. */
  durationSec?: number
  onProgress?: (ratio: number) => void
  signal?: AbortSignal
}
export function runFfmpeg(run: FfmpegRun): Promise<void>
```

- `spawn` with `-hide_banner -nostdin -y`, stderr parsed with a `time=(\d+):(\d+):([\d.]+)` regex.
- Non-zero exit → rejects with the last 20 stderr lines in the message.
- Abort kills the child with SIGKILL and deletes the partial output (caller passes the
  output path as the last arg; wrapper reads it from `args.at(-1)`).
- `ffprobe` is **not** bundled. Duration/dimensions come from the renderer's
  `<video>` element (`duration`, `videoWidth`, `videoHeight`) and are passed in.

Argument builders (pure functions, unit-tested) live in `src/shared/videoArgs.ts`:

```ts
export function trimArgs(input, output, inSec, outSec): string[] // -ss/-to -c copy
export function concatArgs(listFile, output, fromSec?): string[] // concat demuxer, -c copy, optional output-side -ss
export function transcodeArgs(input, output, opts: TranscodeOpts): string[]
export function gifArgs(
  input,
  output,
  opts: { fps: number; width?: number; inSec?; outSec? }
): string[]

export interface TranscodeOpts {
  container: 'mp4' | 'webm'
  height?: 1440 | 1080 | 720 | 480 // scale=-2:h, keep aspect
  quality?: 'high' | 'medium' | 'low' // crf 18 / 23 / 28 (libx264) or 30 / 35 / 40 (libvpx-vp9)
  targetMB?: number // overrides quality: bitrate = targetMB*8000/durationSec - audioKbps
  durationSec: number
  mute?: boolean
  inSec?: number
  outSec?: number
}
```

Rule: if `targetMB` is set → two-pass is **not** used (YAGNI); single-pass
`-b:v X -maxrate X -bufsize 2X`. Ceiling documented with a `ponytail:` comment.

---

## 3. Milestones

### V0 — Spike + ffmpeg plumbing (S)

Purpose: verify the four assumptions the rest depends on, on this Mac with Electron 43,
and land the ffmpeg plumbing. Nothing user-visible.

Checks (a throwaway `spike.html` loaded by a dev-only IPC, deleted before merge):

| #   | Assumption                                                                                                                              | Fallback if false                                                                                        | Result                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2')` is true                                                              | Record `video/webm;codecs=vp9,opus`, ffmpeg remuxes/transcodes to mp4 after stop (slower stop, same UX). | ✅ `video/mp4;codecs=avc1,mp4a.40.2` supported; recorded blob decodes (1662×1078, 2.97s).                                                                                   |
| 2   | `setDisplayMediaRequestHandler(..., { video, audio: 'loopback' })` yields a system-audio track on macOS 13+                             | Confirmed true — system audio is offered on both macOS and Windows.                                      | ✅ `audio tracks: 1 (System audio, deviceId "loopback")` on macOS, despite the typings marking `audio: 'loopback'` Windows-only.                                            |
| 3   | `getDisplayMedia({ video: { width: { max: 1920 }, height: { max: 1080 } } })` downscales the screen track (check `track.getSettings()`) | Route full/window recordings through the existing canvas path (crop = full frame, scale = preset).       | ✅ screen 3024×1964 physical → track reported 1920×1080; decoded video 1662×1078 (aspect-preserving fit, not the raw constraint).                                           |
| 4   | Bundled ffmpeg spawns from a **packaged** build (`ffmpeg -version`), and from `npm run dev`                                             | Fix path resolution / permissions; this must pass.                                                       | ✅ dev: spawns, `ffmpeg version 6.0`. Packaged: spawns `Resources/ffmpeg/ffmpeg` (45.3 MB, 0 entries in app.asar), `${os}-${arch}` macro expanded correctly, no fix needed. |

**Outcome**: check 1 ✅ → V1 records mp4 directly, no webm fallback needed · check 2 ✅
on macOS (contrary to typings marking `audio: 'loopback'` Windows-only) → V1 offers
"system audio" on both macOS and Windows, but the loopback track came back voice-processed
by default (`channelCount: 1`, `echoCancellation`/`noiseSuppression`/`autoGainControl`
all `true`) — V1 must request `audio: { echoCancellation: false, noiseSuppression: false,
autoGainControl: false, channelCount: 2 }` for system audio · check 3 ✅ → screen/window
recordings use constraints, no canvas, but the constraint is applied as an
aspect-preserving fit (3024×1964 → 1920×1080 requested → 1662×1078 decoded), so
`track.getSettings()` does not report the real output size — V1 must read actual size
from the decoded video, and key the bitrate table off the preset rather than the
reported track size · check 4 ✅, dev and packaged, no fix needed.

Deliverables: `scripts/setup-ffmpeg.mjs`, `resources/ffmpeg/` (git-ignored),
`src/main/ffmpeg.ts`, `src/shared/videoArgs.ts` + tests, `electron-builder.yml`
`extraResources`, README third-party note, spike results written to
`docs/superpowers/specs/2026-09-03-video-suite-design.md` §3 (this table's
"Result" column added). Exit: all four rows have a result, plan for V1 adjusted.

### V1 — Recorder pro (M)

**Sources**

| Source      | Entry                                             | Selection UI                |
| ----------- | ------------------------------------------------- | --------------------------- |
| Area        | tray "Record Area…", `recordShortcut`             | existing overlay → rect     |
| Full screen | tray "Record Screen…", new `recordScreenShortcut` | display under cursor, no UI |
| Window      | tray "Record Window…", new `recordWindowShortcut` | existing `picker.html`      |

`CaptureMode` gains `'record-screen' | 'record-window'`. `capture.ts` dispatches; the
window path reuses `windowPicker.ts` and feeds the chosen `source.id` to the display
media handler (extend `pendingDisplayId` into a `pendingSource: { displayId?; sourceId? }`).

**Prefs** (`src/shared/prefs.ts`)

```ts
recordFormat: 'mp4' | 'webm' // mp4 default; 'gif' removed (migration: gif → mp4)
recordResolution: 'native' | 1440 | 1080 | 720
recordFps: 30 | 60
recordMic: boolean // default false
recordSystemAudio: boolean // default true where supported
recordScreenShortcut: string // default 'CommandOrControl+Shift+9'
recordWindowShortcut: string // default 'CommandOrControl+Shift+0'
```

Prefs panel gets a "Recording" section: format, resolution, fps, two audio toggles,
shortcuts (existing shortcut-field component).

**Recorder renderer** (`src/renderer/src/recorder/main.ts`, rewritten)

- `RecordJob` gains `source: 'area' | 'screen' | 'window'`, `resolution`, `fps`,
  `mic`, `systemAudio`, `mimeType`.
- Area: existing canvas crop path, canvas sized to the preset (aspect kept),
  `canvas.captureStream(fps)`.
- Screen / window: no canvas. Constraints `{ frameRate: fps, width: { max }, height: { max } }`
  (or canvas fallback per V0 #3).
- Audio: mic via `getUserMedia({ audio: true })`; system via the display-media
  stream's audio track. Both present → merged with `AudioContext` +
  `MediaStreamAudioDestinationNode` into one track. The recorded stream = video track
  - merged audio track.
- `MediaRecorder(stream, { mimeType, videoBitsPerSecond })`, bitrate table by
  resolution × fps (1080p30 8 Mbps, 1080p60 12, 1440p60 20, native 60 ≈ 25).
- Chunks buffered in memory (`recorder.start(1000)`); on stop the blob goes to main
  via `recordResult` as today. Max 5 min unchanged (a 5 min 1080p60 mp4 ≈ 450 MB in
  memory — acceptable; V3's editor is the path for longer needs, noted in ROADMAP).

**After stop**: main writes the file to a temp path and opens it in the **suite (V3)**.
Until V3 lands: today's save dialog. Control bar unchanged (timer + Done/Cancel).

Tray menu gains the two entries; `shortcuts.ts` registers the two new accelerators.
`gifenc` dependency removed; `recorder/gifenc.d.ts` deleted.

**Landed (2026-09-04)**: `startRecording` now asks for the microphone
(`systemPreferences.askForMediaAccess('microphone')`) on macOS before starting when
`recordMic` is on, showing a "Recording without microphone" notification on denial and
proceeding without it; `electron-builder.yml` carries the required
`NSMicrophoneUsageDescription` string. The control bar remains visible inside
screen/window recordings (see ROADMAP "Deferred technical debt"). Deviation from this
spec: the output container (mp4 vs webm) is chosen in the renderer by `pickMimeType`
based on `MediaRecorder.isTypeSupported`, not carried explicitly as a `mimeType` field
on `RecordJob`.

### V2 — Game clips / replay buffer (M)

**Prefs**

```ts
replayBuffer: 0 | 30 | 60 | 120 | 300 // seconds; 0 = off (default)
replayShortcut: string // default 'CommandOrControl+Shift+8'
clipsDir: string | null // default ~/Movies/Snapkit Clips (Videos on Win/Linux)
clipOpenInEditor: boolean // default false: save silently, toast only
```

**Runtime** (`src/main/replay.ts` + hidden `replay.html` renderer)

- When `replayBuffer > 0` at startup or when the pref changes: main opens a hidden
  BrowserWindow loading `replay.html`, sends `replayStart` with `{ fps, resolution,
systemAudio, mic, segmentSec: 10, keepSec }`. Records the **display under the cursor
  at start** (re-evaluated on each restart if the pref is toggled); multi-display
  follow is out of scope.
- The renderer holds **one** `getDisplayMedia` stream and restarts a `MediaRecorder`
  every 10 s. Each stop yields a self-contained mp4 blob → sent to main via
  `replaySegment` (ArrayBuffer) → written to `app.getPath('temp')/snapkit-replay/seg-<ts>.mp4`.
  Main keeps a ring of the newest `ceil(keepSec / 10) + 1` files, unlinks the rest.
  - `// ponytail: one frame lost at every 10 s boundary; upgrade path = two overlapping
recorders trimmed by timestamps.`
- Disk ceiling: 5 min @ 1080p60 ≈ 750 MB temp. Stated in the prefs UI hint.
- Tray icon swaps to a variant with a red dot while the buffer runs (new asset from
  `make-tray-icon.mjs`). Tray menu item "Save Replay (N s)" mirrors the hotkey.
- Hotkey → main: `flash` (existing) + toast "Saving clip…", writes a concat list of
  the ring files (ordered), `runFfmpeg(concatArgs(list, out, totalSec - keepSec))` — main knows each
  segment's duration, so it seeks forward instead of relying on `-sseof` (unreliable
  with the concat demuxer). Output name
  `Snapkit Clip YYYY-MM-DD at HH.MM.SS.mp4` in `clipsDir`. Then toast "Clip saved"
  (click → `showItemInFolder`), or open in the suite if `clipOpenInEditor`.
- Sleep/wake, display disconnect, or renderer crash → main restarts the buffer
  (`closed` / `render-process-gone` listeners), same pattern as `recorder.ts` `onDied`.
- Manual start/stop recording while the buffer runs: allowed; two independent streams.
  Both use the hidden-window pattern, no shared state.

Not in V2: game detection, in-game overlay, per-app audio, multiple displays.

### V3 — Video suite (L)

**Window**: `video.html` → `src/renderer/src/video/` (React, Zustand store, existing
`components/ui`). Opened by main's `openVideo(filePath)` from: end of a recording,
`clipOpenInEditor`, tray "Edit Video…" (file dialog), drag-and-drop onto the window,
and `snapkit://` deep link is **not** added (YAGNI).

Main reads the file? No — the renderer loads it via the existing `APP_URL` custom
protocol with a `/video?path=` route that streams the file with Range support (needed
for seeking). `protocol.ts` gains that route with a path allow-list (only paths main
handed out through `videoOpen`; anything else → 403).

**Layout**

- Top: `<video>` player, controls (play/pause, scrub, current/total time, mute).
- Timeline strip under the player: filmstrip of ~20 thumbnails (drawn by seeking a
  hidden `<video>` into a canvas), in/out handles draggable, keyboard `I` / `O` set
  in/out at playhead, `[` `]` nudge by one frame (1/fps).
- Right panel (Zustand `videoStore`):
  - Format: mp4 · webm · gif
  - Resolution: Native · 1080p · 720p · 480p (options above source height hidden)
  - Compression: quality High/Medium/Low **or** "Target size" MB input (mutually
    exclusive radio). GIF shows fps (10/15/20) and max width instead.
  - Mute audio toggle (hidden for gif).
  - Estimated output size (bitrate × duration) refreshed live.
  - Export button + progress bar + Cancel.
- Bottom-left: file name, source resolution, duration, size.

**Export path selection** (main, `src/main/video.ts`)

```
if only trim changed and container unchanged → trimArgs (stream copy, instant)
else if gif → gifArgs
else → transcodeArgs
```

Save dialog first (default `exportDir`, name `<original> (edited).<ext>`), then
`runFfmpeg` with progress relayed over IPC (`videoProgress`), then `showItemInFolder`.
Errors surface the wrapper message in a toast; partial output deleted by the wrapper.

**IPC additions** (`src/shared/ipc.ts`)

```
videoOpen        main → suite: { path, name, sizeBytes }
videoExport      suite → main: { path, edits: ExportEdits } → Promise<{ ok, output? , error? }>
videoProgress    main → suite: ratio 0..1
videoCancel      suite → main
videoPickFile    suite/tray → main: open dialog → openVideo
```

**Testing**

- `videoArgs.test.ts`: every builder, golden arg arrays; bitrate math for target size,
  including the clamp to a 300 kbps floor.
- `ffmpeg.test.ts`: progress regex against captured stderr samples; error path.
- `replay.test.ts` (pure ring logic extracted to `ringKeep(files, keepSec, segSec)`).
- Manual smoke checklist in the plan: 60 s 1080p60 recording plays in QuickTime and
  VLC; clip saved < 2 s after hotkey; trim-only export is instant; gif export ≤ 20 MB
  for 10 s at 720 px.

---

## 4. Data flow summary

```
tray / hotkey ─▶ capture.ts ─▶ recorder.ts ─▶ hidden recorder.html
                                  │              getDisplayMedia + MediaRecorder(mp4)
                                  ◀── recordResult (ArrayBuffer) ──┘
                                  ▼
                            temp file ─▶ video.ts openVideo ─▶ video.html (suite)
                                                                   │ edits
                                                                   ▼
                                                            ffmpeg.ts runFfmpeg ─▶ output

replayShortcut ─▶ replay.ts ─▶ ring of 10 s mp4 segments (hidden replay.html)
                       └─▶ concat + -ss ─▶ clipsDir/*.mp4 ─▶ toast / suite
```

---

## 5. Error handling

| Situation                           | Behaviour                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| Screen Recording permission missing | existing `capture.ts` prompt; buffer stays off and prefs toggle shows a warning |
| Mic permission denied               | record without mic, toast once                                                  |
| `MediaRecorder` throws / no data    | main teardown as today, toast "Recording failed" with the error                 |
| ffmpeg missing / not executable     | export button disabled, toast pointing to reinstall; replay pref disabled       |
| ffmpeg exit ≠ 0                     | toast with last stderr lines, partial file removed                              |
| Disk full during replay             | segment write fails → buffer stops, toast, tray icon back to normal             |
| Suite file no longer exists         | player shows "File moved or deleted", export disabled                           |

---

## 6. Dependencies

New: none at runtime (ffmpeg is a resource, not an npm package).
Removed: `gifenc`.
Existing reused: `konva` is **not** used for the timeline (plain DOM + one canvas is
enough); `zustand` for the suite store; `lucide-react` icons.

---

## 7. Open items carried to ROADMAP

- Video crop, speed, webcam overlay, in-game overlay, game auto-detect.
- Two-recorder overlap to remove the boundary frame drop in the replay buffer.
- Two-pass encode for exact target sizes.
- Recordings longer than 5 min (stream chunks to disk instead of memory).
- Positioning: game clips pull Snapkit toward consumers; landing page and pricing
  need a pass before this ships publicly.
