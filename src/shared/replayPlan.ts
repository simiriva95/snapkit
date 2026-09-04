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
export function ringTrim(
  segments: Segment[],
  keepMs: number
): { keep: Segment[]; drop: Segment[] } {
  // Nothing to keep → keep nothing (the buffer is off; callers never store segments then).
  if (keepMs <= 0) return { keep: [], drop: segments }
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
