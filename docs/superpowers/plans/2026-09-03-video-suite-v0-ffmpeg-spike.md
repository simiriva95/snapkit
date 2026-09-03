# Video Suite V0 — ffmpeg plumbing + capture spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the bundled-ffmpeg plumbing (download script, packaging, typed wrapper, pure arg builders) and verify the four capture assumptions from the spec on Electron 43, recording the results in the spec.

**Architecture:** A static ffmpeg binary is fetched per host platform at setup time into `resources/ffmpeg/<os>-<arch>/`, shipped via electron-builder `extraResources`, and spawned from the main process through one wrapper (`src/main/ffmpeg.ts`). Command lines are produced by pure, unit-tested builders in `src/shared/videoArgs.ts`. A throwaway spike window (dev-only, env-gated) exercises `MediaRecorder` mp4, system-audio loopback and resolution constraints; it is deleted at the end of V0.

**Tech Stack:** Electron 43 · electron-vite 5 · Node 24 (script uses global `fetch`) · vitest 4 · ffmpeg 6.0 static builds from `eugeneware/ffmpeg-static` release `b6.1.1`.

Spec: `docs/superpowers/specs/2026-09-03-video-suite-design.md` (§2.1, §2.2, §3 V0).

## Global Constraints

- No new npm runtime dependencies. ffmpeg is a resource, never an npm package.
- Downloads verify a pinned SHA-256; a mismatch is an error, not a warning.
- Only the **host** platform's binary is fetched and packaged (~45–80 MB).
- The binary must never end up inside `app.asar` (`files` must exclude `resources/ffmpeg/**`).
- Main process never captures with ffmpeg; wrapper is post-processing only.
- Every ffmpeg invocation starts with `-hide_banner -nostdin -y`; the output path is always the **last** argument (the wrapper deletes it on failure/abort).
- `npm test`, `npm run typecheck`, `npm run lint` green before every commit.
- Spike code is gated on `process.env.SNAPKIT_SPIKE` and removed in Task 6.

## File structure

| File | Responsibility |
|---|---|
| `scripts/setup-ffmpeg.mjs` (new) | Fetch + verify + chmod the host ffmpeg binary. Idempotent. Wired into `predev`/`prebuild`. |
| `.gitignore` | ignore `resources/ffmpeg/` |
| `package.json` | add the script to `predev` / `prebuild` |
| `electron-builder.yml` | exclude `resources/ffmpeg/**` from asar, add `extraResources` |
| `src/main/ffmpeg.ts` (new) | `ffmpegPath()`, `parseTimeSec()`, `runFfmpeg()` — spawn, progress, tail, abort, cleanup |
| `src/main/ffmpeg.test.ts` (new) | unit (regex) + integration (real binary, `lavfi testsrc`) |
| `src/shared/videoArgs.ts` (new) | pure arg builders: `trimArgs`, `concatArgs`, `transcodeArgs`, `gifArgs`, `videoKbpsForTarget` |
| `src/shared/videoArgs.test.ts` (new) | golden arrays + bitrate math |
| `src/main/spike.ts`, `src/renderer/spike.html`, `src/renderer/src/spike/main.ts` (new, **temporary**) | spike checks 1–4 |
| `src/main/index.ts` | one call: `initSpike()` (temporary) |
| `README.md`, `ROADMAP.md`, spec §3 | docs |

---

### Task 1: ffmpeg download script + packaging wiring

**Files:**
- Create: `scripts/setup-ffmpeg.mjs`
- Modify: `.gitignore`
- Modify: `package.json` (scripts `predev`, `prebuild`)
- Modify: `electron-builder.yml` (`files`, new `extraResources`)

**Interfaces:**
- Produces: binary at `resources/ffmpeg/<os>-<arch>/ffmpeg[.exe]` where `<os>` ∈ `mac | win | linux` (electron-builder `${os}` macro names) and `<arch>` = `process.arch`. Packaged location: `<resourcesPath>/ffmpeg/ffmpeg[.exe]`. Task 2's `ffmpegPath()` depends on exactly these paths.

- [ ] **Step 1: Write the script**

```js
// scripts/setup-ffmpeg.mjs
// Fetches the static ffmpeg binary for the HOST platform into
// resources/ffmpeg/<os>-<arch>/ so the app can spawn it for video
// post-processing (trim/concat/transcode/gif). Shipped via electron-builder
// extraResources — only the host's binary, never all four.
//
// Idempotent: skips when the file exists and its SHA-256 matches. Wired into
// predev/prebuild like setup-ocr.mjs / setup-bgr.mjs. Fatal on hash mismatch.
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('.', import.meta.url)))

// GPL static builds (ffmpeg 6.0). Executed as a separate process, never linked.
const RELEASE = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/'
const BUILDS = {
  'mac-arm64': {
    asset: 'ffmpeg-darwin-arm64',
    sha256: 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584'
  },
  'mac-x64': {
    asset: 'ffmpeg-darwin-x64',
    sha256: 'ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894'
  },
  'linux-x64': {
    asset: 'ffmpeg-linux-x64',
    sha256: 'e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99'
  },
  'win-x64': {
    asset: 'ffmpeg-win32-x64',
    sha256: '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00'
  }
}

// electron-builder's ${os} macro names, so extraResources can point at the folder.
const OS = { darwin: 'mac', win32: 'win', linux: 'linux' }
const key = `${OS[process.platform]}-${process.arch}`
const bin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
const dest = join(root, 'resources/ffmpeg', key, bin)

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

async function main() {
  const build = BUILDS[key]
  if (!build) {
    console.warn(`[setup-ffmpeg] WARNING: no ffmpeg build for ${key} — video features disabled`)
    return
  }
  if (existsSync(dest) && sha256(readFileSync(dest)) === build.sha256) {
    console.log('[setup-ffmpeg] binary already present')
    return
  }
  const url = RELEASE + build.asset
  console.log(`[setup-ffmpeg] downloading ${build.asset}…`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const got = sha256(buf)
  if (got !== build.sha256) throw new Error(`${build.asset}: SHA-256 mismatch (got ${got})`)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, buf)
  chmodSync(dest, 0o755)
  console.log(`[setup-ffmpeg] ${(buf.length / 1e6).toFixed(0)}MB → resources/ffmpeg/${key}/${bin}`)
}

main().catch((err) => {
  // Fatal: a corrupt or missing binary would surface as a confusing runtime
  // error in the video editor. Better to fail the build here.
  console.error(`[setup-ffmpeg] ERROR: ${err.message}`)
  process.exit(1)
})
```

- [ ] **Step 2: Ignore the binaries, wire the script**

Append to `.gitignore`:

```
# generated ffmpeg binary (setup-ffmpeg.mjs)
resources/ffmpeg/
```

In `package.json` change both lines:

```json
"predev": "node scripts/setup-ocr.mjs && node scripts/setup-bgr.mjs && node scripts/setup-ffmpeg.mjs",
"prebuild": "node scripts/setup-ocr.mjs && node scripts/setup-bgr.mjs && node scripts/setup-ffmpeg.mjs",
```

- [ ] **Step 3: Packaging — keep the binary out of the asar, ship it as a resource**

In `electron-builder.yml` replace the `files:` block and add `extraResources` right after it:

```yaml
files:
  - out/**
  - resources/**
  - '!resources/ffmpeg/**'
  - package.json

# Bundled ffmpeg (video post-processing). Only the host platform's binary is
# present (scripts/setup-ffmpeg.mjs) and only it ships: ${os}/${arch} are
# electron-builder macros → mac-arm64, win-x64, linux-x64.
# Read from process.resourcesPath + '/ffmpeg' (see src/main/ffmpeg.ts).
extraResources:
  - from: resources/ffmpeg/${os}-${arch}/
    to: ffmpeg/
```

- [ ] **Step 4: Run the script twice, then run the binary**

Run: `node scripts/setup-ffmpeg.mjs`
Expected (first run, ~45 MB on Apple Silicon):
```
[setup-ffmpeg] downloading ffmpeg-darwin-arm64…
[setup-ffmpeg] 46MB → resources/ffmpeg/mac-arm64/ffmpeg
```
Run: `node scripts/setup-ffmpeg.mjs`
Expected: `[setup-ffmpeg] binary already present`

Run: `resources/ffmpeg/mac-arm64/ffmpeg -version | head -1`
Expected: `ffmpeg version 6.0 Copyright (c) 2000-2023 the FFmpeg developers`

Run: `git status --short`
Expected: only `.gitignore`, `package.json`, `electron-builder.yml`, `scripts/setup-ffmpeg.mjs` listed — **no** `resources/ffmpeg` entry.

- [ ] **Step 5: Corrupt-binary check (the hash guard actually re-downloads)**

Run:
```bash
echo x >> resources/ffmpeg/mac-arm64/ffmpeg && node scripts/setup-ffmpeg.mjs && resources/ffmpeg/mac-arm64/ffmpeg -version | head -1
```
Expected: downloads again (`downloading ffmpeg-darwin-arm64…`), then prints the version line.

- [ ] **Step 6: Commit**

```bash
git add .gitignore package.json electron-builder.yml scripts/setup-ffmpeg.mjs
git commit -m "build: bundle a static ffmpeg per host platform

setup-ffmpeg.mjs fetches the pinned b6.1.1 static build for the host,
verifies SHA-256, and electron-builder ships it via extraResources
(excluded from the asar). Groundwork for the video suite.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `src/main/ffmpeg.ts` — typed spawn wrapper

**Files:**
- Create: `src/main/ffmpeg.ts`
- Create: `src/main/ffmpeg.test.ts`

**Interfaces:**
- Consumes: binary path layout from Task 1.
- Produces:
  ```ts
  export function ffmpegPath(): string
  export function parseTimeSec(line: string): number | null
  export interface FfmpegRun {
    args: string[]                 // output path MUST be the last element
    durationSec?: number
    onProgress?: (ratio: number) => void
    signal?: AbortSignal
  }
  export function runFfmpeg(run: FfmpegRun, bin?: string): Promise<void>
  ```
  `runFfmpeg` rejects with `Error("ffmpeg cancelled")` on abort, or `Error("ffmpeg exited with <code>:\n<last ≤20 stderr lines>")`; in both cases the output file (last arg) is removed. On success `onProgress(1)` is always called last.

Testing note: `src/main/ffmpeg.ts` imports `app` from `electron`, which vitest cannot load in a node environment. The test mocks the module with `vi.mock('electron', …)` — this is the pattern for any main-process module under test that touches `app`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/ffmpeg.test.ts
import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// electron is not loadable under vitest; ffmpeg.ts only needs app.isPackaged/getAppPath.
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() }
}))

import { ffmpegPath, parseTimeSec, runFfmpeg } from './ffmpeg'

describe('parseTimeSec', () => {
  it('reads hh:mm:ss.xx out of a progress line', () => {
    const line =
      'frame=  300 fps=0.0 q=-1.0 Lsize=     412kB time=00:01:05.50 bitrate=  51.5kbits/s speed= 130x'
    expect(parseTimeSec(line)).toBeCloseTo(65.5)
  })
  it('returns null for non-progress lines', () => {
    expect(parseTimeSec('Stream mapping:')).toBeNull()
    expect(parseTimeSec('')).toBeNull()
  })
})

// Real-binary integration. Skipped where setup-ffmpeg.mjs has not run (e.g. an
// unsupported host) so the suite stays green everywhere.
const hasBinary = existsSync(ffmpegPath())
const tmp = (): string => mkdtempSync(join(tmpdir(), 'snapkit-ffmpeg-'))

describe.skipIf(!hasBinary)('runFfmpeg (real binary)', () => {
  it('encodes a synthetic 1s clip and reports progress ending at 1', async () => {
    const out = join(tmp(), 'out.mp4')
    const progress: number[] = []
    await runFfmpeg({
      args: ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x64:rate=10', '-pix_fmt', 'yuv420p', out],
      durationSec: 1,
      onProgress: (r) => progress.push(r)
    })
    expect(existsSync(out)).toBe(true)
    expect(progress.at(-1)).toBe(1)
    expect(progress.every((r) => r >= 0 && r <= 1)).toBe(true)
  })

  it('rejects with the stderr tail and removes the output on failure', async () => {
    const out = join(tmp(), 'out.mp4')
    await expect(runFfmpeg({ args: ['-i', '/definitely/missing.mp4', out] })).rejects.toThrow(
      /ffmpeg exited with 1:[\s\S]*No such file/
    )
    expect(existsSync(out)).toBe(false)
  })

  it('kills the child and removes the output on abort', async () => {
    const out = join(tmp(), 'out.mp4')
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 300)
    // -re paces the synthetic source in real time so 60s really takes 60s.
    await expect(
      runFfmpeg({
        args: ['-re', '-f', 'lavfi', '-i', 'testsrc=duration=60:size=64x64:rate=10', '-pix_fmt', 'yuv420p', out],
        signal: ac.signal
      })
    ).rejects.toThrow('ffmpeg cancelled')
    expect(existsSync(out)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/ffmpeg.test.ts`
Expected: FAIL — `Failed to resolve import "./ffmpeg"`.

- [ ] **Step 3: Implement the wrapper**

```ts
// src/main/ffmpeg.ts
import { app } from 'electron'
import { spawn } from 'child_process'
import { rm } from 'fs/promises'
import { join } from 'path'

/**
 * Bundled ffmpeg: the ONLY way the app touches video files after capture
 * (trim / concat / transcode / gif). Never used to capture the screen —
 * that stays on getDisplayMedia + MediaRecorder (see the video suite spec).
 */

// Folder names follow electron-builder's ${os} macro (see electron-builder.yml).
const OS: Record<string, string> = { darwin: 'mac', win32: 'win', linux: 'linux' }
const BIN = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'

export function ffmpegPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'ffmpeg', BIN)
    : join(
        app.getAppPath(),
        'resources',
        'ffmpeg',
        `${OS[process.platform] ?? process.platform}-${process.arch}`,
        BIN
      )
}

export interface FfmpegRun {
  /** Full argument list; the OUTPUT PATH MUST BE LAST (deleted on failure/abort). */
  args: string[]
  /** Total duration in seconds; turns stderr `time=` into 0..1 progress. */
  durationSec?: number
  onProgress?: (ratio: number) => void
  signal?: AbortSignal
}

const TIME_RE = /time=(\d+):(\d+):([\d.]+)/
const TAIL_LINES = 20

/** Seconds from an ffmpeg progress line (`… time=00:01:05.50 …`), or null. */
export function parseTimeSec(line: string): number | null {
  const m = TIME_RE.exec(line)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

export function runFfmpeg(run: FfmpegRun, bin: string = ffmpegPath()): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-hide_banner', '-nostdin', '-y', ...run.args], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true
    })

    const tail: string[] = []
    let pending = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      // Progress lines end with \r, everything else with \n.
      const lines = (pending + chunk).split(/[\r\n]+/)
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (!line) continue
        tail.push(line)
        if (tail.length > TAIL_LINES) tail.shift()
        const t = parseTimeSec(line)
        if (t !== null && run.durationSec && run.onProgress) {
          run.onProgress(Math.min(1, t / run.durationSec))
        }
      }
    })

    const output = run.args.at(-1)
    const onAbort = (): void => {
      child.kill('SIGKILL')
    }
    run.signal?.addEventListener('abort', onAbort, { once: true })
    if (run.signal?.aborted) onAbort()

    const fail = (why: string): void => {
      const cleanup = output ? rm(output, { force: true }) : Promise.resolve()
      void cleanup.finally(() => reject(new Error(why)))
    }

    child.on('error', (err) => {
      run.signal?.removeEventListener('abort', onAbort)
      fail(`ffmpeg failed to start: ${err.message}`)
    })
    child.on('close', (code) => {
      run.signal?.removeEventListener('abort', onAbort)
      if (run.signal?.aborted) return fail('ffmpeg cancelled')
      if (code !== 0) return fail(`ffmpeg exited with ${code}:\n${tail.join('\n')}`)
      run.onProgress?.(1)
      resolve()
    })
  })
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/main/ffmpeg.test.ts`
Expected: 5 passed (2 unit + 3 integration). The abort test takes ~0.4 s.

- [ ] **Step 5: Typecheck + lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: no output / exit 0.

```bash
git add src/main/ffmpeg.ts src/main/ffmpeg.test.ts
git commit -m "feat(main): ffmpeg spawn wrapper with progress, tail and abort

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `src/shared/videoArgs.ts` — pure command builders

**Files:**
- Create: `src/shared/videoArgs.ts`
- Create: `src/shared/videoArgs.test.ts`

**Interfaces:**
- Produces (consumed by V2 replay and V3 editor):
  ```ts
  export type Container = 'mp4' | 'webm'
  export type Quality = 'high' | 'medium' | 'low'
  export interface TranscodeOpts {
    container: Container
    height?: 1440 | 1080 | 720 | 480
    quality?: Quality             // default 'medium'
    targetMB?: number             // overrides quality
    durationSec: number           // SOURCE duration (before trim)
    mute?: boolean
    inSec?: number
    outSec?: number
  }
  export function videoKbpsForTarget(targetMB: number, durationSec: number, mute: boolean): number
  export function trimArgs(input: string, output: string, inSec: number, outSec: number): string[]
  export function concatArgs(listFile: string, output: string, fromSec?: number): string[]
  export function transcodeArgs(input: string, output: string, o: TranscodeOpts): string[]
  export function gifArgs(input: string, output: string, o: { fps: number; width?: number; inSec?: number; outSec?: number }): string[]
  ```
  Every builder returns the output path as the **last** element (contract with `runFfmpeg`). None of them adds `-hide_banner -nostdin -y` (the wrapper does).

Design notes baked into the tests:
- Trim and concat are stream copies → cuts land on keyframes. `// ponytail:` ceiling; re-encode path (`transcodeArgs` with `inSec/outSec`) is the frame-accurate upgrade.
- `concatArgs(…, fromSec)` uses an **output-side** `-ss` (the spec's `-sseof` idea is replaced: the caller knows the ring's total duration, so it passes `total - keepSec`; positive seeks are reliable with the concat demuxer, `-sseof` is not).
- Target size: single pass, `-b:v -maxrate -bufsize 2×`, floor 300 kbps, audio budget 128 kbps unless muted. `// ponytail: two-pass for exact sizes if users complain.`
- mp4 → `libx264 -preset fast -pix_fmt yuv420p -movflags +faststart` + `aac`; webm → `libvpx-vp9 -b:v 0` (CRF mode) + `libopus`. Software encoders for deterministic output across OSes.

- [ ] **Step 1: Write the failing tests**

```ts
// src/shared/videoArgs.test.ts
import { describe, expect, it } from 'vitest'
import { concatArgs, gifArgs, transcodeArgs, trimArgs, videoKbpsForTarget } from './videoArgs'

describe('trimArgs', () => {
  it('seeks on the input and stream-copies', () => {
    expect(trimArgs('in.mp4', 'out.mp4', 2.5, 10)).toEqual([
      '-ss', '2.5', '-to', '10', '-i', 'in.mp4',
      '-c', 'copy', '-avoid_negative_ts', 'make_zero',
      'out.mp4'
    ])
  })
})

describe('concatArgs', () => {
  it('concatenates a list file with stream copy', () => {
    expect(concatArgs('list.txt', 'clip.mp4')).toEqual([
      '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'clip.mp4'
    ])
  })
  it('drops the head with an output-side -ss when fromSec is given', () => {
    expect(concatArgs('list.txt', 'clip.mp4', 12.5)).toEqual([
      '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-ss', '12.5', '-c', 'copy', 'clip.mp4'
    ])
  })
  it('ignores a zero/negative fromSec', () => {
    expect(concatArgs('list.txt', 'clip.mp4', 0)).not.toContain('-ss')
    expect(concatArgs('list.txt', 'clip.mp4', -3)).not.toContain('-ss')
  })
})

describe('videoKbpsForTarget', () => {
  it('budgets 8192 kbit per MB minus 128 kbps audio', () => {
    // 10 MB over 60 s = 1365.3 kbps total → 1237 for video.
    expect(videoKbpsForTarget(10, 60, false)).toBe(1237)
  })
  it('gives the audio budget back when muted', () => {
    expect(videoKbpsForTarget(10, 60, true)).toBe(1365)
  })
  it('never goes below 300 kbps', () => {
    expect(videoKbpsForTarget(1, 600, false)).toBe(300)
  })
})

describe('transcodeArgs', () => {
  it('mp4 medium quality, no scaling, with audio', () => {
    expect(transcodeArgs('in.mov', 'out.mp4', { container: 'mp4', durationSec: 30 })).toEqual([
      '-i', 'in.mov',
      '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      'out.mp4'
    ])
  })
  it('applies trim range, scale, quality and mute', () => {
    expect(
      transcodeArgs('in.mp4', 'out.mp4', {
        container: 'mp4', durationSec: 30, inSec: 5, outSec: 15, height: 720, quality: 'high', mute: true
      })
    ).toEqual([
      '-ss', '5', '-to', '15', '-i', 'in.mp4',
      '-vf', 'scale=-2:720',
      '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-crf', '18',
      '-an',
      'out.mp4'
    ])
  })
  it('target size uses the TRIMMED duration and caps the bitrate', () => {
    // 10 s kept out of 30 → 5 MB over 10 s = 4096 kbps → 3968 video.
    expect(
      transcodeArgs('in.mp4', 'out.mp4', {
        container: 'mp4', durationSec: 30, inSec: 10, outSec: 20, targetMB: 5
      })
    ).toEqual([
      '-ss', '10', '-to', '20', '-i', 'in.mp4',
      '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-b:v', '3968k', '-maxrate', '3968k', '-bufsize', '7936k',
      '-c:a', 'aac', '-b:a', '128k',
      'out.mp4'
    ])
  })
  it('webm uses vp9 in CRF mode and opus', () => {
    expect(transcodeArgs('in.mp4', 'out.webm', { container: 'webm', durationSec: 30, quality: 'low' })).toEqual([
      '-i', 'in.mp4',
      '-c:v', 'libvpx-vp9',
      '-crf', '40', '-b:v', '0',
      '-c:a', 'libopus', '-b:a', '128k',
      'out.webm'
    ])
  })
})

describe('gifArgs', () => {
  it('builds the palettegen/paletteuse chain with fps and width', () => {
    expect(gifArgs('in.mp4', 'out.gif', { fps: 15, width: 640, inSec: 1, outSec: 4 })).toEqual([
      '-ss', '1', '-to', '4', '-i', 'in.mp4',
      '-vf',
      'fps=15,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
      '-loop', '0',
      'out.gif'
    ])
  })
  it('omits scale when no width is given', () => {
    expect(gifArgs('in.mp4', 'out.gif', { fps: 10 })[3]).toBe(
      'fps=10,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle'
    )
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/shared/videoArgs.test.ts`
Expected: FAIL — `Failed to resolve import "./videoArgs"`.

- [ ] **Step 3: Implement the builders**

```ts
// src/shared/videoArgs.ts
/**
 * Pure ffmpeg argument builders. No I/O, no electron — unit-tested goldens.
 * Contract with runFfmpeg(): the OUTPUT PATH IS ALWAYS THE LAST ELEMENT and
 * the global flags (-hide_banner -nostdin -y) are added by the wrapper.
 */

export type Container = 'mp4' | 'webm'
export type Quality = 'high' | 'medium' | 'low'

export interface TranscodeOpts {
  container: Container
  /** Output height; width follows the aspect ratio (even). */
  height?: 1440 | 1080 | 720 | 480
  /** CRF preset. Ignored when targetMB is set. Default 'medium'. */
  quality?: Quality
  /** Aim for this file size instead of a quality level. */
  targetMB?: number
  /** Duration of the SOURCE in seconds (before any trim). */
  durationSec: number
  mute?: boolean
  inSec?: number
  outSec?: number
}

const AUDIO_KBPS = 128
const MIN_VIDEO_KBPS = 300
const CRF: Record<Container, Record<Quality, number>> = {
  mp4: { high: 18, medium: 23, low: 28 },
  webm: { high: 30, medium: 35, low: 40 }
}

const range = (inSec?: number, outSec?: number): string[] => [
  ...(inSec !== undefined ? ['-ss', String(inSec)] : []),
  ...(outSec !== undefined ? ['-to', String(outSec)] : [])
]

/** Video bitrate (kbps) that lands a file of targetMB over durationSec. */
export function videoKbpsForTarget(targetMB: number, durationSec: number, mute: boolean): number {
  // ponytail: single-pass ABR with maxrate; two-pass if exact sizes ever matter.
  const totalKbps = (targetMB * 8192) / durationSec
  return Math.max(MIN_VIDEO_KBPS, Math.round(totalKbps - (mute ? 0 : AUDIO_KBPS)))
}

/** Lossless, instant cut. ponytail: cuts land on keyframes; use transcodeArgs for frame accuracy. */
export function trimArgs(input: string, output: string, inSec: number, outSec: number): string[] {
  return [...range(inSec, outSec), '-i', input, '-c', 'copy', '-avoid_negative_ts', 'make_zero', output]
}

/**
 * Join same-encoded segments listed in an ffmpeg concat file (`file 'x.mp4'` per line).
 * fromSec > 0 drops the head (output-side seek; keyframe-bound, fine for replay clips).
 */
export function concatArgs(listFile: string, output: string, fromSec?: number): string[] {
  return [
    '-f', 'concat', '-safe', '0', '-i', listFile,
    ...(fromSec !== undefined && fromSec > 0 ? ['-ss', String(fromSec)] : []),
    '-c', 'copy',
    output
  ]
}

export function transcodeArgs(input: string, output: string, o: TranscodeOpts): string[] {
  const args = [...range(o.inSec, o.outSec), '-i', input]
  if (o.height) args.push('-vf', `scale=-2:${o.height}`)

  if (o.container === 'mp4') {
    // ponytail: libx264 everywhere for identical output across OSes; h264_videotoolbox / nvenc if speed complaints.
    args.push('-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart')
  } else {
    args.push('-c:v', 'libvpx-vp9')
  }

  if (o.targetMB !== undefined) {
    const kept = (o.outSec ?? o.durationSec) - (o.inSec ?? 0)
    const kbps = videoKbpsForTarget(o.targetMB, kept, !!o.mute)
    args.push('-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`)
  } else {
    args.push('-crf', String(CRF[o.container][o.quality ?? 'medium']))
    if (o.container === 'webm') args.push('-b:v', '0') // CRF mode for vp9
  }

  if (o.mute) args.push('-an')
  else args.push('-c:a', o.container === 'mp4' ? 'aac' : 'libopus', '-b:a', `${AUDIO_KBPS}k`)

  args.push(output)
  return args
}

export function gifArgs(
  input: string,
  output: string,
  o: { fps: number; width?: number; inSec?: number; outSec?: number }
): string[] {
  const scale = o.width ? `,scale=${o.width}:-1:flags=lanczos` : ''
  const filter =
    `fps=${o.fps}${scale},split[a][b];` +
    '[a]palettegen=stats_mode=diff[p];' +
    '[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle'
  return [...range(o.inSec, o.outSec), '-i', input, '-vf', filter, '-loop', '0', output]
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/shared/videoArgs.test.ts`
Expected: 13 passed.

- [ ] **Step 5: Smoke the builders against the real binary (one-off, not committed)**

Run:
```bash
B=resources/ffmpeg/mac-arm64/ffmpeg; T=$(mktemp -d)
$B -hide_banner -y -f lavfi -i testsrc=duration=4:size=320x240:rate=30 -f lavfi -i sine=frequency=440:duration=4 -c:v libx264 -pix_fmt yuv420p -c:a aac $T/src.mp4 2>/dev/null
$B -hide_banner -y -ss 1 -to 3 -i $T/src.mp4 -c copy -avoid_negative_ts make_zero $T/trim.mp4 2>&1 | tail -1
$B -hide_banner -y -ss 1 -to 3 -i $T/src.mp4 -vf "fps=10,scale=160:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 $T/out.gif 2>&1 | tail -1
$B -hide_banner -y -i $T/src.mp4 -vf scale=-2:120 -c:v libx264 -preset fast -pix_fmt yuv420p -movflags +faststart -b:v 300k -maxrate 300k -bufsize 600k -c:a aac -b:a 128k $T/small.mp4 2>&1 | tail -1
ls -l $T
```
Expected: four files (`src.mp4`, `trim.mp4`, `out.gif`, `small.mp4`), each tail line is a `video:…kB audio:…kB` summary, no `Error`/`Invalid` lines. (The gif filter string and the transcode flags are copied verbatim from the goldens — the point is that ffmpeg 6.0 accepts them.)

- [ ] **Step 6: Typecheck + lint, commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green (existing suites + 18 new tests).

```bash
git add src/shared/videoArgs.ts src/shared/videoArgs.test.ts
git commit -m "feat(shared): pure ffmpeg arg builders (trim, concat, transcode, gif)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Capture spike — checks 1–3 in dev (temporary code)

**Files:**
- Create: `src/main/spike.ts`
- Create: `src/renderer/spike.html`
- Create: `src/renderer/src/spike/main.ts`
- Modify: `src/main/index.ts` (import + one call after `setupDisplayMediaHandler()`)

**Interfaces:**
- Consumes: `ffmpegPath()` from Task 2.
- Produces: results text for spec §3. All of this is deleted in Task 6 — do not polish.

Gate: everything runs only when `SNAPKIT_SPIKE=1`. The spike window is a normal visible window with **no preload** (checks 1–3 are pure web APIs); it only needs main's display-media handler to hand it a screen + loopback audio.

- [ ] **Step 1: Main-side spike**

```ts
// src/main/spike.ts — TEMPORARY (video suite V0). Deleted after results land in the spec.
import { BrowserWindow, desktopCapturer, session } from 'electron'
import { execFile } from 'child_process'
import { ffmpegPath } from './ffmpeg'

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']

export function initSpike(): void {
  if (!process.env['SNAPKIT_SPIKE']) return

  // Check 4: does the bundled binary spawn (dev AND packaged)?
  execFile(ffmpegPath(), ['-version'], (err, stdout) => {
    console.log('[spike] ffmpeg path:', ffmpegPath())
    console.log('[spike] ffmpeg:', err ? `ERROR ${err.message}` : stdout.split('\n')[0])
  })

  if (!RENDERER_DEV_URL) return // packaged run: checks 1–3 are renderer-only, skip

  // Check 2: ask Chromium for system audio alongside the screen.
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
      .catch(() => callback({}))
  })

  const win = new BrowserWindow({ width: 900, height: 700, title: 'Snapkit spike' })
  void win.loadURL(`${RENDERER_DEV_URL}/spike.html`)
}
```

In `src/main/index.ts` add the import next to the recorder import and the call right after `setupDisplayMediaHandler()`:

```ts
import { initSpike } from './spike'
// …
    setupDisplayMediaHandler()
    initSpike()
```

- [ ] **Step 2: Renderer-side spike**

```html
<!-- src/renderer/spike.html — TEMPORARY -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Snapkit — spike</title>
    <style>body{background:#111;color:#ddd;font:13px/1.5 ui-monospace,monospace;padding:16px}</style>
  </head>
  <body>
    <pre id="out">running…</pre>
    <script type="module" src="./src/spike/main.ts"></script>
  </body>
</html>
```

```ts
// src/renderer/src/spike/main.ts — TEMPORARY
const out = document.getElementById('out') as HTMLPreElement
const log = (s: string): void => {
  out.textContent += `\n${s}`
  console.log('[spike]', s)
}
out.textContent = `Electron ${navigator.userAgent.match(/Electron\/[\d.]+/)?.[0]} · ${navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0]}`

async function main(): Promise<void> {
  // Check 1: which MediaRecorder mime types exist here?
  for (const t of [
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9,opus'
  ]) {
    log(`[1] isTypeSupported(${t}) = ${MediaRecorder.isTypeSupported(t)}`)
  }

  // Checks 2 + 3: system audio track present? does the track honor max width/height?
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 60, width: { max: 1920 }, height: { max: 1080 } },
    audio: true
  })
  const v = stream.getVideoTracks()[0]
  const a = stream.getAudioTracks()[0]
  const s = v.getSettings()
  log(`[3] screen ${screen.width}x${screen.height} @dpr ${devicePixelRatio} → track ${s.width}x${s.height} @${s.frameRate}fps`)
  log(`[2] audio tracks: ${stream.getAudioTracks().length}${a ? ` (${a.label}, ${JSON.stringify(a.getSettings())})` : ''}`)

  // Check 1b: record 3 s as mp4 (if supported) and make sure the blob decodes.
  const mime = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus']
    .find((t) => MediaRecorder.isTypeSupported(t))!
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()))
  rec.start(1000)
  await new Promise((r) => setTimeout(r, 3000))
  rec.stop()
  await stopped
  stream.getTracks().forEach((t) => t.stop())
  const blob = new Blob(chunks, { type: mime })
  log(`[1b] recorded ${mime} → ${(blob.size / 1e6).toFixed(2)} MB`)

  const video = document.createElement('video')
  video.src = URL.createObjectURL(blob)
  await new Promise<void>((r, j) => {
    video.onloadedmetadata = () => r()
    video.onerror = () => j(new Error('blob does not decode'))
  })
  log(`[1b] decodes: ${video.videoWidth}x${video.videoHeight}, duration ${video.duration.toFixed(2)}s`)
  log('DONE')
}

main().catch((e) => log(`ERROR ${e instanceof Error ? e.message : String(e)}`))
```

- [ ] **Step 3: Run it**

Run: `SNAPKIT_SPIKE=1 npm run dev`
Expected in the terminal: `[spike] ffmpeg path: …/resources/ffmpeg/mac-arm64/ffmpeg` and `[spike] ffmpeg: ffmpeg version 6.0 …`.
Expected in the spike window (values will differ — copy them verbatim into the results):
```
Electron Electron/43.x · Chrome/1xx
[1] isTypeSupported(video/mp4;codecs=avc1,mp4a.40.2) = true|false
… (5 lines)
[3] screen WxH @dpr 2 → track 1920x1080 @60fps        ← constraints honored if ≤1920x1080
[2] audio tracks: 0|1 (…)
[1b] recorded video/… → N MB
[1b] decodes: WxH, duration ~3.0s
DONE
```
If macOS shows the Screen Recording permission dialog, grant it and rerun.

Interpretation:
- **Check 1 true** iff `video/mp4;codecs=avc1` line is `true` AND `[1b] decodes` appears for an mp4 mime.
- **Check 2 true** iff `audio tracks: 1`.
- **Check 3 true** iff the track's width/height ≤ 1920×1080 while the screen (× dpr) is larger.

- [ ] **Step 4: Commit the spike as-is (it's removed in Task 6; committing keeps the trail)**

```bash
git add src/main/spike.ts src/renderer/spike.html src/renderer/src/spike/main.ts src/main/index.ts
git commit -m "spike: dev-only window probing MediaRecorder mp4, loopback audio, constraints

Temporary; removed once results are recorded in the design spec.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Check 4 from a packaged build

**Files:** none modified.

- [ ] **Step 1: Package**

Run: `npm run package`
Expected: ends with `• building  target=DMG …` / `zip` lines, exit 0. Output under `dist/mac-arm64/`. (Several minutes; prebuild logs `[setup-ffmpeg] binary already present`.)

- [ ] **Step 2: The binary is a resource, not in the asar**

Run:
```bash
ls -l dist/mac-arm64/Snapkit.app/Contents/Resources/ffmpeg/ffmpeg
npx @electron/asar list dist/mac-arm64/Snapkit.app/Contents/Resources/app.asar | grep -c ffmpeg
```
Expected: the `ls` shows a ~45 MB `-rwxr-xr-x` file; the grep count is `0` (nothing named ffmpeg inside the asar).

If `Resources/ffmpeg/ffmpeg` is missing, electron-builder did not expand `${os}` in `extraResources.from`. Fallback: delete the top-level `extraResources` block and add per-platform ones —
```yaml
mac:
  extraResources: [{ from: 'resources/ffmpeg/mac-${arch}/', to: ffmpeg/ }]
win:
  extraResources: [{ from: 'resources/ffmpeg/win-${arch}/', to: ffmpeg/ }]
linux:
  extraResources: [{ from: 'resources/ffmpeg/linux-${arch}/', to: ffmpeg/ }]
```
then re-run `npm run package`.

- [ ] **Step 3: Spawn from the packaged app**

Run: `SNAPKIT_SPIKE=1 dist/mac-arm64/Snapkit.app/Contents/MacOS/Snapkit`
Expected in the terminal within a few seconds:
```
[spike] ffmpeg path: /…/Snapkit.app/Contents/Resources/ffmpeg/ffmpeg
[spike] ffmpeg: ffmpeg version 6.0 Copyright (c) 2000-2023 the FFmpeg developers
```
Quit the app (tray → Quit).

If instead the message is `ERROR spawn … EACCES` → the executable bit was lost; fix by adding to `electron-builder.yml`:
```yaml
  # extraResources are copied with their mode; if a platform drops it, restore it.
afterPack: scripts/after-pack.mjs
```
with a 6-line script that `chmodSync(join(appOutDir, 'Snapkit.app/Contents/Resources/ffmpeg/ffmpeg'), 0o755)` — only if actually needed.
If the message is `ERROR … killed` (SIGKILL) → Gatekeeper rejected the code signature; fix by adding `execSync(\`codesign --force -s - "${dest}"\`)` after `chmodSync` in `setup-ffmpeg.mjs` (darwin only) — again only if actually needed. Record whichever fix (if any) was required.

---

### Task 6: Record results, remove the spike, document

**Files:**
- Modify: `docs/superpowers/specs/2026-09-03-video-suite-design.md` (§3 V0 table)
- Delete: `src/main/spike.ts`, `src/renderer/spike.html`, `src/renderer/src/spike/main.ts`
- Modify: `src/main/index.ts` (remove import + call)
- Modify: `README.md` (Under-the-hood table row, third-party note, dev commands)
- Modify: `ROADMAP.md` (3.1 status)

- [ ] **Step 1: Results into the spec**

In §3 V0, add a `Result` column to the four-row table and fill it with the exact values observed (mime support list, `audio tracks: N`, track WxH vs screen, packaged spawn OK + any fix applied). Below the table add one line per consequence, e.g.:

```
**Outcome**: check 1 ✅ → V1 records mp4 directly · check 2 ❌ on macOS → V1 hides
"system audio" on macOS, Windows keeps it · check 3 ✅ → screen/window recordings use
constraints, no canvas · check 4 ✅ (no fix needed).
```
(Replace ✅/❌ with what actually happened.)

- [ ] **Step 2: Remove the spike**

```bash
git rm -q src/main/spike.ts src/renderer/spike.html src/renderer/src/spike/main.ts
```
In `src/main/index.ts` delete the `import { initSpike } from './spike'` line and the `initSpike()` call.

Run: `npm run typecheck && npm run lint && npm test`
Expected: green.

- [ ] **Step 3: README**

In the "Under the hood" table change the Recording row to:

```
| Recording    | getDisplayMedia → MediaRecorder; post-processing via bundled ffmpeg (setup-ffmpeg.mjs) |
```

In "Development" add to the command block:

```bash
node scripts/setup-ffmpeg.mjs   # fetch the pinned static ffmpeg for this machine (predev does it too)
```

Before the "## License" section add:

```markdown
## Third-party binaries

- **ffmpeg 6.0** — static GPL build from [eugeneware/ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)
  (release `b6.1.1`), fetched at build time by `scripts/setup-ffmpeg.mjs`, SHA-256 pinned.
  Executed as a separate process for video trim/convert/compress — never linked into the app.
  Source and license: <https://ffmpeg.org/legal.html>.
```

- [ ] **Step 4: ROADMAP**

Change row 3.1 to:

```
| 3.1 | Video / GIF recording                 | XL     | **In progress** — see `docs/superpowers/specs/2026-09-03-video-suite-design.md` (V0 ffmpeg plumbing ✅, V1 recorder, V2 replay buffer, V3 editor). |
```

- [ ] **Step 5: Commit**

```bash
git add -A docs README.md ROADMAP.md src/main/index.ts
git commit -m "docs: V0 spike results, ffmpeg third-party note, roadmap status

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 6: Final verification**

Run: `git status --short && npm test && npm run typecheck && npm run lint`
Expected: clean tree, all green. V0 done; V1 plan is written next, informed by the spec's Outcome line.
