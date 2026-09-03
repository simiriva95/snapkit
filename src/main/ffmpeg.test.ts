import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
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
      args: [
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=1:size=64x64:rate=10',
        '-pix_fmt',
        'yuv420p',
        out
      ],
      durationSec: 1,
      onProgress: (r) => progress.push(r)
    })
    expect(existsSync(out)).toBe(true)
    expect(progress.at(-1)).toBe(1)
    expect(progress.every((r) => r >= 0 && r <= 1)).toBe(true)
  })

  it('rejects with the stderr tail and removes the output on failure', async () => {
    const out = join(tmp(), 'out.mp4')
    // The exit code itself is ffmpeg's business (1 on 6.x, 254 on 9.x) — what
    // this pins is that the code and the stderr tail reach the caller.
    await expect(runFfmpeg({ args: ['-i', '/definitely/missing.mp4', out] })).rejects.toThrow(
      /ffmpeg exited with \d+:[\s\S]*No such file/
    )
    expect(existsSync(out)).toBe(false)
  })

  it('leaves a PRE-EXISTING output untouched when ffmpeg fails', async () => {
    const out = join(tmp(), 'precious.mp4')
    const bytes = Buffer.from('not a video, but the user cares about it')
    writeFileSync(out, bytes)
    await expect(
      runFfmpeg({ args: ['-i', '/definitely/missing.mp4', '-c', 'copy', out] })
    ).rejects.toThrow(/ffmpeg exited with \d+:/)
    expect(existsSync(out)).toBe(true)
    expect(readFileSync(out).equals(bytes)).toBe(true)
  })

  it('kills the child and removes the output on abort', async () => {
    const out = join(tmp(), 'out.mp4')
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 300)
    // -re paces the synthetic source in real time so 60s really takes 60s.
    await expect(
      runFfmpeg({
        args: [
          '-re',
          '-f',
          'lavfi',
          '-i',
          'testsrc=duration=60:size=64x64:rate=10',
          '-pix_fmt',
          'yuv420p',
          out
        ],
        signal: ac.signal
      })
    ).rejects.toThrow('ffmpeg cancelled')
    expect(existsSync(out)).toBe(false)
  })
})
